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
    const legacyMemory = legacyState.memory as unknown as Record<string, unknown>
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

  describe('snapshot()', () => {
    test('returns a deep-cloned state after load()', async () => {
      const api = createMockRisuaiApi()
      const store = new CanonicalStore(api.pluginStorage)
      await store.load()

      const snap = store.snapshot()

      expect(snap).toBeDefined()
      expect(snap.schemaVersion).toBe(1)
      expect(snap.projectKey).toBe('default-project')
      expect(snap.memory.summaries).toEqual([])
    })

    test('mutating the returned snapshot does not affect internal state', async () => {
      const api = createMockRisuaiApi()
      const store = new CanonicalStore(api.pluginStorage)
      await store.load()

      const snap = store.snapshot()
      snap.memory.summaries.push({
        id: 'mutant',
        text: 'Should not appear in store',
        recencyWeight: 1,
        updatedAt: Date.now()
      })

      const snap2 = store.snapshot()
      expect(snap2.memory.summaries).toEqual([])
    })
  })

  describe('legacy continuity sync', () => {
    test('load() mirrors director.continuityFacts into memory.continuityFacts when memory field is missing', async () => {
      const api = createMockRisuaiApi()
      const legacyState = createEmptyState()
      legacyState.director.continuityFacts = [
        { id: 'cf-1', text: 'The castle was destroyed', priority: 0.9 }
      ]
      const legacyMemory = legacyState.memory as unknown as Record<string, unknown>
      delete legacyMemory.continuityFacts
      await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, legacyState)

      const store = new CanonicalStore(api.pluginStorage)
      const state = await store.load()

      expect(state.memory.continuityFacts).toEqual([
        { id: 'cf-1', text: 'The castle was destroyed', priority: 0.9 }
      ])
    })

    test('load() deep-clones mirrored continuity facts so nested entityIds arrays are not shared', async () => {
      const api = createMockRisuaiApi()
      const legacyState = createEmptyState()
      legacyState.director.continuityFacts = [
        {
          id: 'cf-1',
          text: 'The tower is warded',
          priority: 0.9,
          entityIds: ['tower']
        }
      ]
      const legacyMemory = legacyState.memory as unknown as Record<string, unknown>
      delete legacyMemory.continuityFacts
      await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, legacyState)

      const store = new CanonicalStore(api.pluginStorage)
      const state = await store.load()

      state.memory.continuityFacts[0]?.entityIds?.push('ward')

      expect(state.memory.continuityFacts[0]?.entityIds).toEqual(['tower', 'ward'])
      expect(state.director.continuityFacts[0]?.entityIds).toEqual(['tower'])
    })
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
