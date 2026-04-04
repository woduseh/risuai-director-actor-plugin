import { CanonicalStore, DIRECTOR_STATE_STORAGE_KEY, MEMDIR_MIGRATION_MARKER_NS } from '../src/memory/canonicalStore.js'
import { TurnCache } from '../src/memory/turnCache.js'
import { createEmptyState } from '../src/contracts/types.js'
import { MemdirStore } from '../src/memory/memdirStore.js'
import { createMockRisuaiApi, InMemoryAsyncStore } from './helpers/mockRisuai.js'

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

  test('patches legacy state missing worldFacts, entities, and relations to empty arrays', async () => {
    const api = createMockRisuaiApi()
    const legacyState = createEmptyState()
    const legacyMemory = legacyState.memory as unknown as Record<string, unknown>
    delete legacyMemory.worldFacts
    delete legacyMemory.entities
    delete legacyMemory.relations
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, legacyState)

    const store = new CanonicalStore(api.pluginStorage)
    const state = await store.load()

    expect(state.memory.worldFacts).toEqual([])
    expect(state.memory.entities).toEqual([])
    expect(state.memory.relations).toEqual([])
  })

  test('patches legacy state missing memory.summaries to empty array', async () => {
    const api = createMockRisuaiApi()
    const legacyState = createEmptyState()
    const legacyMemory = legacyState.memory as unknown as Record<string, unknown>
    delete legacyMemory.summaries
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, legacyState)

    const store = new CanonicalStore(api.pluginStorage)
    const state = await store.load()

    expect(state.memory.summaries).toEqual([])
  })

  test('legacy state missing summaries does not break memdir migration', async () => {
    const storage = new InMemoryAsyncStore()
    const scopeKey = 'scope:legacy-sum:test'
    const storageKey = `continuity-director-state::${scopeKey}`

    const legacyState = createEmptyState()
    legacyState.memory.entities = [
      { id: 'e-1', name: 'Alice', facts: ['Brave'], updatedAt: 1000 },
    ]
    const legacyMemory = legacyState.memory as unknown as Record<string, unknown>
    delete legacyMemory.summaries
    await storage.setItem(storageKey, legacyState)

    const memdirStore = new MemdirStore(storage, scopeKey)
    const store = new CanonicalStore(storage, { storageKey, memdirStore })
    const state = await store.load()

    expect(state.memory.summaries).toEqual([])
    const marker = await store.getMigrationMarker()
    expect(marker).not.toBeNull()
    expect(marker!.docCount).toBe(1)
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

// ── Memdir migration gate ──────────────────────────────────────────────

describe('CanonicalStore memdir migration', () => {
  function makePopulatedState() {
    const state = createEmptyState()
    state.memory.entities = [
      { id: 'e-1', name: 'Alice', facts: ['Wizard', 'Kind'], updatedAt: 1000 },
      { id: 'e-2', name: 'Bob', facts: ['Warrior'], updatedAt: 2000 },
    ]
    state.memory.relations = [
      { id: 'r-1', sourceId: 'e-1', targetId: 'e-2', label: 'allies', facts: ['Trust'], updatedAt: 1500 },
    ]
    state.memory.worldFacts = [
      { id: 'wf-1', text: 'The kingdom is at war', updatedAt: 3000 },
    ]
    state.memory.continuityFacts = [
      { id: 'cf-1', text: 'The ring was lost last session', priority: 0.9 },
    ]
    state.memory.summaries = [
      { id: 's-1', text: 'Alice and Bob traveled north', recencyWeight: 1, updatedAt: 4000 },
    ]
    return state
  }

  test('lazily migrates legacy canonical memory into memdir on first load', async () => {
    const storage = new InMemoryAsyncStore()
    const scopeKey = 'scope:test-char:test-chat'
    const storageKey = `continuity-director-state::${scopeKey}`

    // Persist a populated state under the scoped key
    await storage.setItem(storageKey, makePopulatedState())

    const memdirStore = new MemdirStore(storage, scopeKey)
    const store = new CanonicalStore(storage, {
      storageKey,
      memdirStore,
    })

    await store.load()

    // Migration marker must exist
    const marker = await store.getMigrationMarker()
    expect(marker).not.toBeNull()
    expect(marker!.scopeKey).toBe(scopeKey)
    // 2 entities + 1 relation + 1 worldFact + 1 continuityFact + 1 summary = 6
    expect(marker!.docCount).toBe(6)

    // Memdir must have the documents
    const docs = await memdirStore.listDocuments()
    expect(docs.length).toBe(6)
  })

  test('migration is idempotent — re-load does not create duplicates', async () => {
    const storage = new InMemoryAsyncStore()
    const scopeKey = 'scope:idem:test'
    const storageKey = `continuity-director-state::${scopeKey}`

    await storage.setItem(storageKey, makePopulatedState())

    const memdirStore = new MemdirStore(storage, scopeKey)
    const store = new CanonicalStore(storage, {
      storageKey,
      memdirStore,
    })

    // First load triggers migration
    await store.load()
    const firstDocs = await memdirStore.listDocuments()

    // Second load should not re-migrate
    const store2 = new CanonicalStore(storage, {
      storageKey,
      memdirStore,
    })
    await store2.load()
    const secondDocs = await memdirStore.listDocuments()

    expect(secondDocs.length).toBe(firstDocs.length)
  })

  test('dual-read: canonical state is still returned after migration', async () => {
    const storage = new InMemoryAsyncStore()
    const scopeKey = 'scope:dual:test'
    const storageKey = `continuity-director-state::${scopeKey}`

    const populated = makePopulatedState()
    populated.projectKey = 'my-project'
    await storage.setItem(storageKey, populated)

    const memdirStore = new MemdirStore(storage, scopeKey)
    const store = new CanonicalStore(storage, {
      storageKey,
      memdirStore,
    })

    const state = await store.load()

    // Canonical state fields still readable
    expect(state.projectKey).toBe('my-project')
    expect(state.memory.entities).toHaveLength(2)

    // Memdir also has documents
    const docs = await memdirStore.listDocuments()
    expect(docs.length).toBeGreaterThan(0)
  })

  test('single-write: writeFirst still persists canonical state', async () => {
    const storage = new InMemoryAsyncStore()
    const scopeKey = 'scope:write:test'
    const storageKey = `continuity-director-state::${scopeKey}`

    await storage.setItem(storageKey, makePopulatedState())

    const memdirStore = new MemdirStore(storage, scopeKey)
    const store = new CanonicalStore(storage, {
      storageKey,
      memdirStore,
    })

    await store.load()

    // Write adds a new entity to canonical — backward compat
    const updated = await store.writeFirst(async (s) => {
      s.memory.entities.push({
        id: 'e-new',
        name: 'Carol',
        facts: ['Healer'],
        updatedAt: Date.now(),
      })
      return s
    })

    expect(updated.memory.entities).toHaveLength(3)

    // Canonical storage persisted the write
    const raw = await storage.getItem<{ memory: { entities: unknown[] } }>(storageKey)
    expect(raw!.memory.entities).toHaveLength(3)
  })

  test('safe fallback when memdir migration is partially complete', async () => {
    const storage = new InMemoryAsyncStore()
    const scopeKey = 'scope:partial:test'
    const storageKey = `continuity-director-state::${scopeKey}`

    const populated = makePopulatedState()
    await storage.setItem(storageKey, populated)

    // Simulate partial migration: marker exists but memdir is empty
    const markerKey = `${MEMDIR_MIGRATION_MARKER_NS}:${scopeKey}`
    await storage.setItem(markerKey, {
      scopeKey,
      migratedAt: Date.now(),
      schemaVersion: 2,
      docCount: 6,
    })

    const memdirStore = new MemdirStore(storage, scopeKey)
    const store = new CanonicalStore(storage, {
      storageKey,
      memdirStore,
    })

    // Load should still succeed and canonical data is available
    const state = await store.load()
    expect(state.memory.entities).toHaveLength(2)
    expect(state.memory.worldFacts).toHaveLength(1)

    // Memdir may be empty but that's OK — canonical is the fallback
    expect(state.schemaVersion).toBe(1)
  })

  test('skips migration when no memdirStore is provided', async () => {
    const storage = new InMemoryAsyncStore()
    const storageKey = `continuity-director-state::scope:no-memdir:test`

    await storage.setItem(storageKey, makePopulatedState())

    const store = new CanonicalStore(storage, { storageKey })
    const state = await store.load()

    // No migration marker set
    const marker = await store.getMigrationMarker()
    expect(marker).toBeNull()

    // State loads normally
    expect(state.memory.entities).toHaveLength(2)
  })

  test('getMigrationMarker returns null when not migrated', async () => {
    const storage = new InMemoryAsyncStore()
    const store = new CanonicalStore(storage)
    expect(await store.getMigrationMarker()).toBeNull()
  })

  test('onMigrationError callback receives errors from failed migration', async () => {
    const storage = new InMemoryAsyncStore()
    const scopeKey = 'scope:err:test'
    const storageKey = `continuity-director-state::${scopeKey}`

    await storage.setItem(storageKey, makePopulatedState())

    // Create a MemdirStore that throws on putDocument
    const memdirStore = new MemdirStore(storage, scopeKey)
    const originalPut = memdirStore.putDocument.bind(memdirStore)
    memdirStore.putDocument = async () => { throw new Error('disk full') }

    const errors: unknown[] = []
    const store = new CanonicalStore(storage, {
      storageKey,
      memdirStore,
      onMigrationError: (err) => errors.push(err),
    })

    // load() should succeed despite migration failure
    const state = await store.load()
    expect(state.memory.entities).toHaveLength(2)

    // The callback must have been invoked with the error
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('disk full')

    // No marker set — migration will be retried
    const marker = await store.getMigrationMarker()
    expect(marker).toBeNull()
  })

  test('migration failure without onMigrationError does not throw', async () => {
    const storage = new InMemoryAsyncStore()
    const scopeKey = 'scope:silent:test'
    const storageKey = `continuity-director-state::${scopeKey}`

    await storage.setItem(storageKey, makePopulatedState())

    const memdirStore = new MemdirStore(storage, scopeKey)
    memdirStore.putDocument = async () => { throw new Error('boom') }

    const store = new CanonicalStore(storage, { storageKey, memdirStore })

    // Must not throw — backward compat
    const state = await store.load()
    expect(state.memory.entities).toHaveLength(2)
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
