import type { AsyncKeyValueStore, RisuaiApi } from '../contracts/risuai.js'
import type { ScopeRegistry } from '../contracts/memorySchema.js'
import {
  createScopeRegistry,
  registerFingerprint,
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
      : []

    const chatId =
      typeof c.id === 'string'
        ? c.id
        : typeof c.id === 'number'
          ? String(c.id)
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

  // Use chat.chatId as fingerprint input if available, otherwise
  // fall back to the content-based chatFingerprint helper.
  let chatFp: string
  if (chat.chatId != null && chat.chatId.length > 0) {
    // Stable host-provided chat ID — use it directly as fingerprint input
    // by hashing it together with the character chaId for uniqueness.
    chatFp = chatFingerprint(
      character.chaId,
      chat.chatId,
      0,
      [],
    )
  } else {
    chatFp = chatFingerprint(
      character.chaId,
      chat.name,
      chat.lastDate,
      chat.messages.map((m) => m.content),
    )
  }

  // Register the fingerprint in the scope registry for stability
  const registry = await loadRegistry(api.pluginStorage)
  const scopeKey = composeScopeKey(charIdentity.fingerprint, chatFp)
  registerFingerprint(registry, scopeKey, `${character.name}`)
  await saveRegistry(api.pluginStorage, registry)

  const storageKey = composeStorageKey(STORAGE_NAMESPACE, scopeKey)
  return { storageKey, isFallback: false }
}
