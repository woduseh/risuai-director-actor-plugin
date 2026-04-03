import { CanonicalStore, DIRECTOR_STATE_STORAGE_KEY } from '../src/memory/canonicalStore.js'
import { resolveScopeStorageKey, SCOPE_REGISTRY_KEY } from '../src/memory/scopeResolver.js'
import { createEmptyState } from '../src/contracts/types.js'
import { createMockRisuaiApi } from './helpers/mockRisuai.js'
import type { MockRisuaiApi } from './helpers/mockRisuai.js'

// ── Helpers ──────────────────────────────────────────────────────────────

function attachHostApis(
  api: MockRisuaiApi,
  options?: {
    chaId?: string
    charName?: string
    charIndex?: number
    chatIndex?: number
    chat?: {
      id?: string | number
      name?: string
      lastDate?: number
      messages?: Array<{ role: string; content: string }>
    }
  },
): void {
  const chaId = options?.chaId ?? 'char-1'
  const charName = options?.charName ?? 'Alice'
  const charIndex = options?.charIndex ?? 0
  const chatIndex = options?.chatIndex ?? 0
  const chat = options?.chat ?? {
    id: 'chat-42',
    name: 'Main Chat',
    lastDate: 1700000000000,
    messages: [{ role: 'user', content: 'Hello world' }],
  }

  const extended = api as unknown as Record<string, unknown>
  extended['getCharacter'] = async () => ({ chaId, name: charName })
  extended['getCurrentCharacterIndex'] = async () => charIndex
  extended['getCurrentChatIndex'] = async () => chatIndex
  extended['getChatFromIndex'] = async (_ci: number, _chi: number) => chat
}

async function resolveKey(api: MockRisuaiApi): Promise<string> {
  const result = await resolveScopeStorageKey(api)
  return result.storageKey
}

// ── Scope resolver tests ─────────────────────────────────────────────────

describe('resolveScopeStorageKey', () => {
  test('returns deterministic scoped key for same character/chat', async () => {
    const api = createMockRisuaiApi()
    attachHostApis(api)

    const key1 = await resolveKey(api)
    const key2 = await resolveKey(api)

    expect(key1).toBe(key2)
    expect(key1).not.toBe(DIRECTOR_STATE_STORAGE_KEY)
    expect(key1).toContain('::scope:')
  })

  test('falls back to flat key when host APIs are unavailable', async () => {
    const api = createMockRisuaiApi()
    // No host APIs attached

    const result = await resolveScopeStorageKey(api)

    expect(result.storageKey).toBe(DIRECTOR_STATE_STORAGE_KEY)
    expect(result.isFallback).toBe(true)
  })

  test('falls back when getCharacter returns null', async () => {
    const api = createMockRisuaiApi()
    const extended = api as unknown as Record<string, unknown>
    extended['getCharacter'] = async () => null

    const result = await resolveScopeStorageKey(api)
    expect(result.storageKey).toBe(DIRECTOR_STATE_STORAGE_KEY)
    expect(result.isFallback).toBe(true)
  })

  test('falls back when getChatFromIndex returns null', async () => {
    const api = createMockRisuaiApi()
    const extended = api as unknown as Record<string, unknown>
    extended['getCharacter'] = async () => ({ chaId: 'c1', name: 'X' })
    extended['getCurrentCharacterIndex'] = async () => 0
    extended['getCurrentChatIndex'] = async () => 0
    extended['getChatFromIndex'] = async () => null

    const result = await resolveScopeStorageKey(api)
    expect(result.storageKey).toBe(DIRECTOR_STATE_STORAGE_KEY)
    expect(result.isFallback).toBe(true)
  })

  test('different character/chat pairs produce different keys', async () => {
    const api1 = createMockRisuaiApi()
    attachHostApis(api1, { chaId: 'char-A', charName: 'Alice', chat: { id: 'chat-1', name: 'Chat 1', lastDate: 1, messages: [] } })

    const api2 = createMockRisuaiApi()
    attachHostApis(api2, { chaId: 'char-B', charName: 'Bob', chat: { id: 'chat-2', name: 'Chat 2', lastDate: 2, messages: [] } })

    const key1 = await resolveKey(api1)
    const key2 = await resolveKey(api2)

    expect(key1).not.toBe(key2)
  })

  test('same character with different chats produce different keys', async () => {
    const api1 = createMockRisuaiApi()
    attachHostApis(api1, { chaId: 'char-1', chat: { id: 'chat-A', name: 'A', lastDate: 1, messages: [] } })

    const api2 = createMockRisuaiApi()
    attachHostApis(api2, { chaId: 'char-1', chat: { id: 'chat-B', name: 'B', lastDate: 2, messages: [] } })

    const key1 = await resolveKey(api1)
    const key2 = await resolveKey(api2)

    expect(key1).not.toBe(key2)
  })

  test('uses chat.id as stable fingerprint input when available', async () => {
    const api1 = createMockRisuaiApi()
    attachHostApis(api1, { chaId: 'char-1', chat: { id: 'stable-id', name: 'Changed Name', lastDate: 100, messages: [] } })

    const api2 = createMockRisuaiApi()
    attachHostApis(api2, { chaId: 'char-1', chat: { id: 'stable-id', name: 'Different Name', lastDate: 200, messages: [{ role: 'user', content: 'new' }] } })

    const key1 = await resolveKey(api1)
    const key2 = await resolveKey(api2)

    // Same chat ID → same key, even though name/lastDate/messages differ
    expect(key1).toBe(key2)
  })

  test('registers fingerprint in scope registry', async () => {
    const api = createMockRisuaiApi()
    attachHostApis(api)

    await resolveScopeStorageKey(api)

    const registry = await api.pluginStorage.getItem(SCOPE_REGISTRY_KEY)
    expect(registry).not.toBeNull()
    expect((registry as { entries: unknown[] }).entries.length).toBeGreaterThan(0)
  })

  test('gracefully handles getCharacter throwing an error', async () => {
    const api = createMockRisuaiApi()
    const extended = api as unknown as Record<string, unknown>
    extended['getCharacter'] = async () => { throw new Error('Host unavailable') }

    const result = await resolveScopeStorageKey(api)
    expect(result.storageKey).toBe(DIRECTOR_STATE_STORAGE_KEY)
    expect(result.isFallback).toBe(true)
  })

  test('falls back to chatFingerprint when chat has no id', async () => {
    const api1 = createMockRisuaiApi()
    attachHostApis(api1, {
      chaId: 'char-1',
      chat: { name: 'Adventure', lastDate: 1000, messages: [{ role: 'user', content: 'begin' }] },
    })

    const api2 = createMockRisuaiApi()
    attachHostApis(api2, {
      chaId: 'char-1',
      chat: { name: 'Adventure', lastDate: 1000, messages: [{ role: 'user', content: 'begin' }] },
    })

    const key1 = await resolveKey(api1)
    const key2 = await resolveKey(api2)
    expect(key1).toBe(key2)
    expect(key1).not.toBe(DIRECTOR_STATE_STORAGE_KEY)
  })

  test('keeps same key for the same chat when only lastDate changes and host exposes chat.message', async () => {
    const api1 = createMockRisuaiApi()
    const api2 = createMockRisuaiApi()
    const chatA = {
      name: 'Adventure',
      lastDate: 1000,
      message: [{ role: 'user', data: 'begin' }],
    }
    const chatB = {
      name: 'Adventure',
      lastDate: 2000,
      message: [{ role: 'user', data: 'begin' }],
    }

    const extended1 = api1 as unknown as Record<string, unknown>
    extended1['getCharacter'] = async () => ({ chaId: 'char-1', name: 'Alice' })
    extended1['getCurrentCharacterIndex'] = async () => 0
    extended1['getCurrentChatIndex'] = async () => 0
    extended1['getChatFromIndex'] = async () => chatA

    const extended2 = api2 as unknown as Record<string, unknown>
    extended2['getCharacter'] = async () => ({ chaId: 'char-1', name: 'Alice' })
    extended2['getCurrentCharacterIndex'] = async () => 0
    extended2['getCurrentChatIndex'] = async () => 0
    extended2['getChatFromIndex'] = async () => chatB

    const key1 = await resolveKey(api1)
    const key2 = await resolveKey(api2)

    expect(key1).toBe(key2)
  })

  test('keeps the same scope key when message-level chatId is present before host chat.id appears', async () => {
    const api = createMockRisuaiApi()
    const extended = api as unknown as Record<string, unknown>
    extended['getCharacter'] = async () => ({ chaId: 'char-1', name: 'Alice' })
    extended['getCurrentCharacterIndex'] = async () => 0
    extended['getCurrentChatIndex'] = async () => 0
    extended['getChatFromIndex'] = async () => ({
      name: 'Adventure',
      lastDate: 1000,
      message: [{ role: 'user', data: 'begin', chatId: 'chat-42' }],
    })

    const keyBeforeId = await resolveKey(api)

    extended['getChatFromIndex'] = async () => ({
      id: 'chat-42',
      name: 'Renamed Adventure',
      lastDate: 9999,
      message: [{ role: 'user', data: 'begin' }],
    })

    const keyAfterId = await resolveKey(api)

    expect(keyAfterId).toBe(keyBeforeId)
  })

  test('keeps the same key while a no-id chat accumulates opening messages', async () => {
    const api = createMockRisuaiApi()
    const extended = api as unknown as Record<string, unknown>
    extended['getCharacter'] = async () => ({ chaId: 'char-1', name: 'Alice' })
    extended['getCurrentCharacterIndex'] = async () => 0
    extended['getCurrentChatIndex'] = async () => 0

    let currentMessages: Array<{ role: string; data: string }> = []
    extended['getChatFromIndex'] = async () => ({
      name: 'Adventure',
      lastDate: 1000 + currentMessages.length,
      message: currentMessages,
    })

    const key0 = await resolveKey(api)

    currentMessages = [{ role: 'user', data: 'Hello' }]
    const key1 = await resolveKey(api)

    currentMessages = [
      { role: 'user', data: 'Hello' },
      { role: 'assistant', data: 'Welcome aboard.' },
    ]
    const key2 = await resolveKey(api)

    currentMessages = [
      { role: 'user', data: 'Hello' },
      { role: 'assistant', data: 'Welcome aboard.' },
      { role: 'user', data: 'Tell me about this place.' },
    ]
    const key3 = await resolveKey(api)

    expect(key1).toBe(key0)
    expect(key2).toBe(key0)
    expect(key3).toBe(key0)
  })

  test('does not merge different stable chat ids that share the same name and opening messages', async () => {
    const api = createMockRisuaiApi()
    const extended = api as unknown as Record<string, unknown>
    extended['getCharacter'] = async () => ({ chaId: 'char-1', name: 'Alice' })
    extended['getCurrentCharacterIndex'] = async () => 0
    extended['getCurrentChatIndex'] = async () => 0

    let currentChat = {
      id: 'id-AAA',
      name: 'New Chat',
      lastDate: 1000,
      message: [{ role: 'assistant', data: 'Hello!' }],
    }
    extended['getChatFromIndex'] = async () => currentChat

    const keyA = await resolveKey(api)

    currentChat = {
      id: 'id-BBB',
      name: 'New Chat',
      lastDate: 2000,
      message: [{ role: 'assistant', data: 'Hello!' }],
    }
    const keyB = await resolveKey(api)

    expect(keyB).not.toBe(keyA)
  })

  test('does not merge different chats that share the same opening messages when no stable chat id exists', async () => {
    const api = createMockRisuaiApi()
    const extended = api as unknown as Record<string, unknown>
    extended['getCharacter'] = async () => ({ chaId: 'char-1', name: 'Alice' })
    extended['getCurrentCharacterIndex'] = async () => 0
    extended['getCurrentChatIndex'] = async () => 0
    extended['getChatFromIndex'] = async () => ({
      name: 'Adventure',
      lastDate: 1000,
      message: [{ role: 'user', data: 'Hello' }],
    })

    const keyA = await resolveKey(api)

    extended['getChatFromIndex'] = async () => ({
      name: 'Mystery',
      lastDate: 2000,
      message: [{ role: 'user', data: 'Hello' }],
    })

    const keyB = await resolveKey(api)

    expect(keyB).not.toBe(keyA)
  })
})

// ── Scoped CanonicalStore tests ──────────────────────────────────────────

describe('CanonicalStore (scoped)', () => {
  const SCOPED_KEY = 'director-plugin-state::scope:abc123:def456'

  test('loads from scoped key when data exists there', async () => {
    const api = createMockRisuaiApi()
    const scopedState = createEmptyState({ projectKey: 'scoped-project' })
    await api.pluginStorage.setItem(SCOPED_KEY, scopedState)

    const store = new CanonicalStore(api.pluginStorage, {
      storageKey: SCOPED_KEY,
      migrateFromFlatKey: true,
    })
    const state = await store.load()

    expect(state.projectKey).toBe('scoped-project')
  })

  test('migrates flat-key data on first scoped load when scoped key is empty', async () => {
    const api = createMockRisuaiApi()
    const legacyState = createEmptyState({ projectKey: 'legacy-project' })
    legacyState.memory.summaries.push({
      id: 's1',
      text: 'Legacy summary',
      recencyWeight: 1,
      updatedAt: Date.now(),
    })
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, legacyState)

    const store = new CanonicalStore(api.pluginStorage, {
      storageKey: SCOPED_KEY,
      migrateFromFlatKey: true,
    })
    const state = await store.load()

    expect(state.projectKey).toBe('legacy-project')
    expect(state.memory.summaries).toHaveLength(1)
    expect(state.memory.summaries[0]?.text).toBe('Legacy summary')
  })

  test('does not delete flat key after migration', async () => {
    const api = createMockRisuaiApi()
    const legacyState = createEmptyState({ projectKey: 'legacy-project' })
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, legacyState)

    const store = new CanonicalStore(api.pluginStorage, {
      storageKey: SCOPED_KEY,
      migrateFromFlatKey: true,
    })
    await store.load()

    const flatStillExists = await api.pluginStorage.getItem(DIRECTOR_STATE_STORAGE_KEY)
    expect(flatStillExists).not.toBeNull()
  })

  test('persists migrated data to the scoped key', async () => {
    const api = createMockRisuaiApi()
    const legacyState = createEmptyState({ projectKey: 'legacy-project' })
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, legacyState)

    const store = new CanonicalStore(api.pluginStorage, {
      storageKey: SCOPED_KEY,
      migrateFromFlatKey: true,
    })
    await store.load()

    const scopedData = await api.pluginStorage.getItem(SCOPED_KEY)
    expect(scopedData).not.toBeNull()
    expect((scopedData as { projectKey: string }).projectKey).toBe('legacy-project')
  })

  test('does not override existing scoped data with flat-key data', async () => {
    const api = createMockRisuaiApi()

    // Both exist: scoped has its own data
    const scopedState = createEmptyState({ projectKey: 'scoped-data' })
    await api.pluginStorage.setItem(SCOPED_KEY, scopedState)

    const legacyState = createEmptyState({ projectKey: 'legacy-data' })
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, legacyState)

    const store = new CanonicalStore(api.pluginStorage, {
      storageKey: SCOPED_KEY,
      migrateFromFlatKey: true,
    })
    const state = await store.load()

    expect(state.projectKey).toBe('scoped-data')
  })

  test('writeFirst writes to scoped key, not flat key', async () => {
    const api = createMockRisuaiApi()

    const store = new CanonicalStore(api.pluginStorage, {
      storageKey: SCOPED_KEY,
    })

    await store.writeFirst((s) => {
      s.projectKey = 'written-scoped'
      return s
    })

    const scopedData = await api.pluginStorage.getItem(SCOPED_KEY)
    expect(scopedData).not.toBeNull()
    expect((scopedData as { projectKey: string }).projectKey).toBe('written-scoped')

    // Flat key should NOT have this data
    const flatData = await api.pluginStorage.getItem(DIRECTOR_STATE_STORAGE_KEY)
    expect(flatData).toBeNull()
  })

  test('does not attempt migration when storageKey is the flat key', async () => {
    const api = createMockRisuaiApi()
    const existingState = createEmptyState({ projectKey: 'existing' })
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, existingState)

    // migrateFromFlatKey=true but storageKey=flat key → migration disabled
    const store = new CanonicalStore(api.pluginStorage, {
      storageKey: DIRECTOR_STATE_STORAGE_KEY,
      migrateFromFlatKey: true,
    })
    const state = await store.load()

    expect(state.projectKey).toBe('existing')
  })

  test('stateStorageKey getter returns the configured key', () => {
    const api = createMockRisuaiApi()
    const store = new CanonicalStore(api.pluginStorage, {
      storageKey: SCOPED_KEY,
    })
    expect(store.stateStorageKey).toBe(SCOPED_KEY)
  })

  test('stateStorageKey defaults to flat key when no option given', () => {
    const api = createMockRisuaiApi()
    const store = new CanonicalStore(api.pluginStorage)
    expect(store.stateStorageKey).toBe(DIRECTOR_STATE_STORAGE_KEY)
  })

  test('returns empty state when both scoped and flat keys are empty (no migration)', async () => {
    const api = createMockRisuaiApi()

    const store = new CanonicalStore(api.pluginStorage, {
      storageKey: SCOPED_KEY,
      migrateFromFlatKey: true,
    })
    const state = await store.load()

    expect(state.projectKey).toBe('default-project')
    expect(state.memory.summaries).toEqual([])
  })
})

// ── Dashboard store scoping tests ────────────────────────────────────────

describe('Dashboard fallback reads with scoped key', () => {
  test('createDashboardStore threads stateStorageKey', async () => {
    // Inline import to avoid jsdom env requirement for this simple test
    const { createDashboardStore } = await import('../src/ui/dashboardApp.js')
    const api = createMockRisuaiApi()
    const scopedKey = 'director-plugin-state::scope:x:y'

    const dashStore = createDashboardStore(api, undefined, scopedKey)

    expect(dashStore.stateStorageKey).toBe(scopedKey)
  })

  test('readCanonical fallback reads from provided scoped key', async () => {
    const api = createMockRisuaiApi()
    const scopedKey = 'director-plugin-state::scope:x:y'
    const scopedState = createEmptyState({ projectKey: 'scoped-dashboard' })
    await api.pluginStorage.setItem(scopedKey, scopedState)

    // DashboardStore without writeCanonical → fallback path in readCanonicalState
    const { createDashboardStore } = await import('../src/ui/dashboardApp.js')
    const dashStore = createDashboardStore(api, undefined, scopedKey)

    // Directly verify storage read behavior matches the key
    const raw = await dashStore.storage.getItem(
      dashStore.stateStorageKey ?? DIRECTOR_STATE_STORAGE_KEY,
    )
    expect(raw).not.toBeNull()
    expect((raw as { projectKey: string }).projectKey).toBe('scoped-dashboard')
  })
})
