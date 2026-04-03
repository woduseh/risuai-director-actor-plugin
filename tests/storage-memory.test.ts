import { CanonicalStore, DIRECTOR_STATE_STORAGE_KEY } from '../src/memory/canonicalStore.js'
import { TurnCache } from '../src/memory/turnCache.js'
import { createEmptyState } from '../src/contracts/types.js'
import { createMockRisuaiApi } from './helpers/mockRisuai.js'

describe('CanonicalStore', () => {
  test('loads a default state when storage is empty', async () => {
    const api = createMockRisuaiApi()
    const store = new CanonicalStore(api.pluginStorage)

    const state = await store.load()

    expect(state.schemaVersion).toBe(1)
    expect(state.projectKey).toBe('default-project')
    expect(state.memory.summaries).toEqual([])
  })

  test('patches legacy state missing memory.continuityFacts to empty array', async () => {
    const api = createMockRisuaiApi()
    // Simulate a legacy persisted state that pre-dates the continuityFacts field
    const legacyState = createEmptyState()
    const legacyMemory = legacyState.memory as Record<string, unknown>
    delete legacyMemory.continuityFacts
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, legacyState)

    const store = new CanonicalStore(api.pluginStorage)
    const state = await store.load()

    expect(state.memory.continuityFacts).toEqual([])
  })

  test('writeFirst persists before afterPersist callback observes storage', async () => {
    const api = createMockRisuaiApi()
    const store = new CanonicalStore(api.pluginStorage)
    let snapshotFromStorage = null as Awaited<ReturnType<typeof api.pluginStorage.getItem>> | null

    const updated = await store.writeFirst(
      async (state) => {
        const next = createEmptyState({
          projectKey: state.projectKey,
          characterKey: state.characterKey,
          sessionKey: state.sessionKey
        })
        next.memory.summaries.push({
          id: 'summary-1',
          text: 'Persistent summary',
          recencyWeight: 1,
          updatedAt: Date.now()
        })
        return next
      },
      async () => {
        snapshotFromStorage = await api.pluginStorage.getItem(DIRECTOR_STATE_STORAGE_KEY)
      }
    )

    expect(updated.memory.summaries).toHaveLength(1)
    expect(snapshotFromStorage).not.toBeNull()
    expect((snapshotFromStorage as { memory: { summaries: unknown[] } }).memory.summaries).toHaveLength(1)
  })
})

describe('TurnCache', () => {
  test('begins, patches, and finalizes turn contexts', () => {
    const cache = new TurnCache()
    const turn = cache.begin('model', [{ role: 'user', content: 'hello' }])

    expect(turn.turnId).toBeTruthy()
    expect(cache.get(turn.turnId)?.finalized).toBe(false)

    const patched = cache.patch(turn.turnId, { lastOutputText: 'partial', finalized: false })

    expect(patched.lastOutputText).toBe('partial')

    cache.finalize(turn.turnId)

    expect(cache.get(turn.turnId)?.finalized).toBe(true)
  })
})
