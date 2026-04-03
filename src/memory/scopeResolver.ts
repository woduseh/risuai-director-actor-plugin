import type { AsyncKeyValueStore, RisuaiApi } from '../contracts/risuai.js'
import type { ScopeRegistry } from '../contracts/memorySchema.js'
import {
  aliasFingerprint,
  createScopeRegistry,
  registerFingerprint,
  resolveScope,
} from '../contracts/memorySchema.js'
import {
  characterScopeIdentity,
  chatFingerprint,
  composeScopeKey,
  composeStorageKey,
} from './scopeKeys.js'
import { DIRECTOR_STATE_STORAGE_KEY } from './canonicalStore.js'

/** Storage key for the persisted scope registry. */
export const SCOPE_REGISTRY_KEY = 'director-scope-registry'

/** Namespace used when composing scoped storage keys. */
const STORAGE_NAMESPACE = 'director-plugin-state'

/**
 * Attempt to retrieve the current character snapshot from the host API.
 * Returns `null` when the method is unavailable or throws.
 */
async function tryGetCharacter(
  api: RisuaiApi,
): Promise<{ chaId: string; name: string } | null> {
  try {
    const anyApi = api as unknown as Record<string, unknown>
    const getCharacter = anyApi['getCharacter']
    if (typeof getCharacter !== 'function') return null
    const char = await (getCharacter as () => Promise<unknown>).call(api)
    if (
      char != null &&
      typeof char === 'object' &&
      typeof (char as Record<string, unknown>).chaId === 'string' &&
      typeof (char as Record<string, unknown>).name === 'string'
    ) {
      return {
        chaId: (char as Record<string, unknown>).chaId as string,
        name: (char as Record<string, unknown>).name as string,
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Attempt to retrieve the current chat snapshot from the host API.
 * Returns `null` when any required method is unavailable or throws.
 */
async function tryGetChat(
  api: RisuaiApi,
): Promise<{
  chatId?: string
  name: string
  lastDate: number
  messages: ReadonlyArray<{ role: string; content: string }>
} | null> {
  try {
    const anyApi = api as unknown as Record<string, unknown>
    const getCurrentCharacterIndex = anyApi['getCurrentCharacterIndex']
    const getCurrentChatIndex = anyApi['getCurrentChatIndex']
    const getChatFromIndex = anyApi['getChatFromIndex']

    if (
      typeof getCurrentCharacterIndex !== 'function' ||
      typeof getCurrentChatIndex !== 'function' ||
      typeof getChatFromIndex !== 'function'
    ) {
      return null
    }

    const charIndex = await (
      getCurrentCharacterIndex as () => Promise<number>
    ).call(api)
    const chatIndex = await (
      getCurrentChatIndex as () => Promise<number>
    ).call(api)
    const chat = await (
      getChatFromIndex as (ci: number, chi: number) => Promise<unknown>
    ).call(api, charIndex, chatIndex)

    if (chat == null || typeof chat !== 'object') return null

    const c = chat as Record<string, unknown>
    const name = typeof c.name === 'string' ? c.name : ''
    const lastDate = typeof c.lastDate === 'number' ? c.lastDate : 0
    const messages = Array.isArray(c.messages)
      ? (c.messages as Array<{ role: string; content: string }>)
          .filter(
            (entry) =>
              entry != null &&
              typeof entry.role === 'string' &&
              typeof entry.content === 'string',
          )
      : Array.isArray(c.message)
        ? (c.message as Array<{ role: string; data: string; chatId?: string }>)
            .filter(
              (entry) =>
                entry != null &&
                typeof entry.role === 'string' &&
                typeof entry.data === 'string',
            )
            .map((entry) => ({ role: entry.role, content: entry.data }))
        : []

    const messageChatId = Array.isArray(c.message)
      ? (c.message as Array<{ chatId?: string }>).find(
          (entry) => typeof entry?.chatId === 'string' && entry.chatId.length > 0,
        )?.chatId
      : undefined

    const chatId =
      typeof c.id === 'string'
        ? c.id
        : typeof c.id === 'number'
          ? String(c.id)
          : typeof messageChatId === 'string'
            ? messageChatId
          : undefined

    const result: {
      chatId?: string
      name: string
      lastDate: number
      messages: ReadonlyArray<{ role: string; content: string }>
    } = { name, lastDate, messages }
    if (chatId !== undefined) {
      result.chatId = chatId
    }
    return result
  } catch {
    return null
  }
}

/**
 * Load the persisted scope registry from storage, or create a fresh one.
 */
async function loadRegistry(
  storage: AsyncKeyValueStore,
): Promise<ScopeRegistry> {
  const raw = await storage.getItem<ScopeRegistry>(SCOPE_REGISTRY_KEY)
  if (
    raw != null &&
    typeof raw === 'object' &&
    Array.isArray((raw as ScopeRegistry).entries)
  ) {
    return raw as ScopeRegistry
  }
  return createScopeRegistry()
}

/**
 * Persist the scope registry to storage.
 */
async function saveRegistry(
  storage: AsyncKeyValueStore,
  registry: ScopeRegistry,
): Promise<void> {
  await storage.setItem(SCOPE_REGISTRY_KEY, structuredClone(registry))
}

function uniqueFingerprints(fingerprints: ReadonlyArray<string>): string[] {
  return Array.from(new Set(fingerprints))
}

function resolveFirstScope(
  registry: ScopeRegistry,
  fingerprints: ReadonlyArray<string>,
): string | undefined {
  return fingerprints
    .map((fingerprint) => resolveScope(registry, fingerprint))
    .find((value): value is string => typeof value === 'string' && value.length > 0)
}

function removeFingerprintFromScope(
  registry: ScopeRegistry,
  scopeId: string,
  fingerprint: string,
): void {
  const entry = registry.entries.find((candidate) => candidate.scopeId === scopeId)
  if (!entry) {
    return
  }

  const nextFingerprints = entry.fingerprints.filter(
    (candidate) => candidate !== fingerprint,
  )
  if (nextFingerprints.length === entry.fingerprints.length) {
    return
  }

  entry.fingerprints = nextFingerprints
  entry.updatedAt = Date.now()
}

function buildNoIdFingerprints(
  chaId: string,
  chatName: string,
  messageTexts: ReadonlyArray<string>,
): {
  resolveFingerprints: string[]
  aliasFingerprints: string[]
  emptyFingerprint: string
} {
  const emptyFingerprint = chatFingerprint(chaId, chatName, 0, [])
  const aliasFingerprints: string[] = []
  for (let count = messageTexts.length; count >= 1; count--) {
    aliasFingerprints.push(
      chatFingerprint(chaId, chatName, 0, messageTexts.slice(0, count)),
    )
  }

  if (aliasFingerprints.length === 0) {
    aliasFingerprints.push(emptyFingerprint)
  }

  const resolveFingerprints =
    aliasFingerprints[0] === emptyFingerprint
      ? aliasFingerprints
      : [...aliasFingerprints, emptyFingerprint]

  return {
    resolveFingerprints: uniqueFingerprints(resolveFingerprints),
    aliasFingerprints: uniqueFingerprints(aliasFingerprints),
    emptyFingerprint,
  }
}

export interface ScopeResolution {
  /** The resolved storage key (scoped or legacy flat). */
  storageKey: string
  /** Whether the resolution fell back to the legacy flat key. */
  isFallback: boolean
}

/**
 * Resolve the scoped storage key for the current character + chat context.
 *
 * Uses host APIs in order:
 *   1. `getCharacter()` for character identity
 *   2. `getCurrentCharacterIndex()` / `getCurrentChatIndex()`
 *   3. `getChatFromIndex(charIdx, chatIdx)` for chat snapshot
 *
 * If the host APIs are unavailable or return unusable data, falls back
 * to the legacy flat key `director-plugin-state`.
 *
 * Chat fingerprints are registered in a persisted scope registry so the
 * storage key stays stable even when no host chat id is available.
 */
export async function resolveScopeStorageKey(
  api: RisuaiApi,
): Promise<ScopeResolution> {
  const character = await tryGetCharacter(api)
  if (!character) {
    return { storageKey: DIRECTOR_STATE_STORAGE_KEY, isFallback: true }
  }

  const chat = await tryGetChat(api)
  if (!chat) {
    return { storageKey: DIRECTOR_STATE_STORAGE_KEY, isFallback: true }
  }

  const charIdentity = characterScopeIdentity(character.chaId, character.name)
  const registry = await loadRegistry(api.pluginStorage)
  let scopeId: string | undefined
  let aliasFingerprints: string[] = []
  let emptyFingerprint: string | undefined

  if (chat.chatId != null && chat.chatId.length > 0) {
    const stableFingerprint = chatFingerprint(character.chaId, chat.chatId, 0, [])
    scopeId = resolveFirstScope(registry, [stableFingerprint])
    aliasFingerprints = [stableFingerprint]
  } else {
    const messageTexts = chat.messages.map((m) => m.content)
    const noIdFingerprints = buildNoIdFingerprints(
      character.chaId,
      chat.name,
      messageTexts,
    )
    scopeId = resolveFirstScope(registry, noIdFingerprints.resolveFingerprints)
    aliasFingerprints = noIdFingerprints.aliasFingerprints
    emptyFingerprint = noIdFingerprints.emptyFingerprint
  }

  if (!scopeId) {
    const primaryFingerprint = aliasFingerprints[0]!
    scopeId = registerFingerprint(
      registry,
      primaryFingerprint,
      `${character.name} / ${chat.name}`,
      {
        generateId: () => `sc-${primaryFingerprint}`,
      },
    )
  }

  for (const fingerprint of aliasFingerprints) {
    aliasFingerprint(registry, scopeId, fingerprint)
  }

  if (
    chat.chatId == null &&
    emptyFingerprint !== undefined &&
    !aliasFingerprints.includes(emptyFingerprint)
  ) {
    removeFingerprintFromScope(registry, scopeId, emptyFingerprint)
  }

  await saveRegistry(api.pluginStorage, registry)

  const scopeKey = composeScopeKey(charIdentity.fingerprint, scopeId)
  const storageKey = composeStorageKey(STORAGE_NAMESPACE, scopeKey)
  return { storageKey, isFallback: false }
}
