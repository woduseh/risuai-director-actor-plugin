import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InMemoryAsyncStore } from './helpers/mockRisuai.js'
import { MemdirStore } from '../src/memory/memdirStore.js'
import type { MemdirDocument, MemdirSource, MemdirDocumentType } from '../src/contracts/types.js'
import {
  createAutoDreamWorker,
  type AutoDreamDeps,
  type DreamCadenceGate,
  type DreamResult,
} from '../src/memory/autoDream.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(overrides?: Partial<MemdirDocument>): MemdirDocument {
  const id = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  return {
    id,
    type: 'character' as MemdirDocumentType,
    title: `Test doc ${id}`,
    description: `Description of ${id}`,
    scopeKey: 'test-scope',
    updatedAt: Date.now(),
    source: 'extraction' as MemdirSource,
    freshness: 'current',
    tags: [],
    ...overrides,
  }
}

function makeGate(overrides?: Partial<DreamCadenceGate>): DreamCadenceGate {
  return {
    enabled: true,
    lastDreamTs: 0,
    dreamMinHoursElapsed: 0, // no time gate in tests by default
    turnsSinceLastDream: 10,
    dreamMinTurnsElapsed: 5,
    sessionsSinceLastDream: 3,
    dreamMinSessionsElapsed: 2,
    userInteractionGuardMs: 0, // disabled by default in tests
    lastUserInteractionTs: 0,
    ...overrides,
  }
}

function makeDeps(
  store: MemdirStore,
  overrides?: Partial<AutoDreamDeps>,
): AutoDreamDeps {
  return {
    memdirStore: store,
    log: vi.fn(),
    runConsolidationModel: vi.fn(async (_prompt: string) => {
      return JSON.stringify({
        merges: [],
        prunes: [],
        updates: [],
      })
    }),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('autoDream — cadence gate', () => {
  it('blocks when feature is disabled', () => {
    const gate = makeGate({ enabled: false })
    const worker = createAutoDreamWorker(
      makeDeps(new MemdirStore(new InMemoryAsyncStore(), 'test')),
    )
    expect(worker.shouldRun(gate)).toBe(false)
  })

  it('blocks when not enough time has elapsed', () => {
    const now = Date.now()
    const gate = makeGate({
      lastDreamTs: now - 1000,
      dreamMinHoursElapsed: 4, // need 4 hours
    })
    const worker = createAutoDreamWorker(
      makeDeps(new MemdirStore(new InMemoryAsyncStore(), 'test')),
    )
    expect(worker.shouldRun(gate)).toBe(false)
  })

  it('blocks when not enough turns have elapsed', () => {
    const gate = makeGate({
      turnsSinceLastDream: 2,
      dreamMinTurnsElapsed: 5,
    })
    const worker = createAutoDreamWorker(
      makeDeps(new MemdirStore(new InMemoryAsyncStore(), 'test')),
    )
    expect(worker.shouldRun(gate)).toBe(false)
  })

  it('blocks when not enough sessions have elapsed', () => {
    const gate = makeGate({
      sessionsSinceLastDream: 1,
      dreamMinSessionsElapsed: 2,
    })
    const worker = createAutoDreamWorker(
      makeDeps(new MemdirStore(new InMemoryAsyncStore(), 'test')),
    )
    expect(worker.shouldRun(gate)).toBe(false)
  })

  it('passes when all thresholds are met', () => {
    const gate = makeGate({
      lastDreamTs: 0,
      dreamMinHoursElapsed: 0,
      turnsSinceLastDream: 10,
      dreamMinTurnsElapsed: 5,
      sessionsSinceLastDream: 3,
      dreamMinSessionsElapsed: 2,
    })
    const worker = createAutoDreamWorker(
      makeDeps(new MemdirStore(new InMemoryAsyncStore(), 'test')),
    )
    expect(worker.shouldRun(gate)).toBe(true)
  })

  it('blocks when user interaction guard is active', () => {
    const now = Date.now()
    const gate = makeGate({
      userInteractionGuardMs: 5000,
      lastUserInteractionTs: now - 1000, // only 1s ago
    })
    const worker = createAutoDreamWorker(
      makeDeps(new MemdirStore(new InMemoryAsyncStore(), 'test')),
    )
    expect(worker.shouldRun(gate)).toBe(false)
  })

  it('passes user interaction guard after enough time', () => {
    const now = Date.now()
    const gate = makeGate({
      userInteractionGuardMs: 5000,
      lastUserInteractionTs: now - 10_000, // 10s ago, guard is 5s
    })
    const worker = createAutoDreamWorker(
      makeDeps(new MemdirStore(new InMemoryAsyncStore(), 'test')),
    )
    expect(worker.shouldRun(gate)).toBe(true)
  })

  it('blocks autoDream when refresh guard timestamp is recent (simulating startup window)', () => {
    const now = Date.now()
    // Simulate the integration pattern from index.ts:
    // lastUserInteractionTs = Math.max(lastUserInteractionTs, refreshGuard.latestGuardTs())
    // A recent startup stamp makes the effective interaction ts very recent,
    // so the userInteractionGuardMs gate blocks.
    const recentStartupTs = now - 2000 // startup 2s ago
    const staleUserTs = now - 60_000 // user was active 60s ago
    const effectiveTs = Math.max(staleUserTs, recentStartupTs) // = recentStartupTs

    const gate = makeGate({
      userInteractionGuardMs: 10_000,
      lastUserInteractionTs: effectiveTs,
    })
    const worker = createAutoDreamWorker(
      makeDeps(new MemdirStore(new InMemoryAsyncStore(), 'test')),
    )
    expect(worker.shouldRun(gate)).toBe(false)
  })
})

describe('autoDream — consolidation worker', () => {
  let store: InMemoryAsyncStore
  let memdirStore: MemdirStore

  beforeEach(() => {
    store = new InMemoryAsyncStore()
    memdirStore = new MemdirStore(store, 'test-scope')
  })

  it('merges duplicate docs with same title and type', async () => {
    const doc1 = makeDoc({
      id: 'dup-1',
      type: 'character',
      title: 'Alice',
      description: 'Alice is kind',
      source: 'extraction',
      updatedAt: 1000,
    })
    const doc2 = makeDoc({
      id: 'dup-2',
      type: 'character',
      title: 'Alice',
      description: 'Alice is brave',
      source: 'extraction',
      updatedAt: 2000,
    })
    await memdirStore.putDocument(doc1)
    await memdirStore.putDocument(doc2)

    const deps = makeDeps(memdirStore, {
      runConsolidationModel: vi.fn(async () =>
        JSON.stringify({
          merges: [
            {
              sourceIds: ['dup-1', 'dup-2'],
              mergedDoc: {
                type: 'character',
                title: 'Alice',
                description: 'Alice is kind and brave',
                tags: [],
              },
            },
          ],
          prunes: [],
          updates: [],
        }),
      ),
    })

    const worker = createAutoDreamWorker(deps)
    const result = await worker.run()

    expect(result.merged).toBeGreaterThan(0)

    // Original docs should be removed, replaced by merged doc
    const remainingDocs = await memdirStore.listDocuments()
    expect(remainingDocs.length).toBe(1)
    expect(remainingDocs[0]!.title).toBe('Alice')
    expect(remainingDocs[0]!.description).toContain('kind and brave')
  })

  it('prunes stale extraction docs', async () => {
    const staleDoc = makeDoc({
      id: 'stale-1',
      type: 'plot',
      title: 'Old event',
      description: 'This happened ages ago',
      source: 'extraction',
      freshness: 'stale',
      updatedAt: 1000,
    })
    await memdirStore.putDocument(staleDoc)
    // Need ≥2 eligible docs to trigger consolidation
    await memdirStore.putDocument(
      makeDoc({ id: 'filler-stale', source: 'extraction' }),
    )

    const deps = makeDeps(memdirStore, {
      runConsolidationModel: vi.fn(async () =>
        JSON.stringify({
          merges: [],
          prunes: ['stale-1'],
          updates: [],
        }),
      ),
    })

    const worker = createAutoDreamWorker(deps)
    const result = await worker.run()

    expect(result.pruned).toBeGreaterThan(0)
    const remaining = await memdirStore.listDocuments()
    // stale-1 pruned, filler-stale remains
    expect(remaining.length).toBe(1)
    expect(remaining[0]!.id).toBe('filler-stale')
  })

  it('preserves user-locked (operator/manual) memories from pruning', async () => {
    const operatorDoc = makeDoc({
      id: 'operator-1',
      type: 'character',
      title: 'Core trait',
      description: 'Operator defined trait',
      source: 'operator',
    })
    const manualDoc = makeDoc({
      id: 'manual-1',
      type: 'world',
      title: 'World rule',
      description: 'Manual world rule',
      source: 'manual',
    })
    await memdirStore.putDocument(operatorDoc)
    await memdirStore.putDocument(manualDoc)

    // Even if model says prune them, worker should refuse
    const deps = makeDeps(memdirStore, {
      runConsolidationModel: vi.fn(async () =>
        JSON.stringify({
          merges: [],
          prunes: ['operator-1', 'manual-1'],
          updates: [],
        }),
      ),
    })

    const worker = createAutoDreamWorker(deps)
    const result = await worker.run()

    expect(result.pruned).toBe(0)
    const remaining = await memdirStore.listDocuments()
    expect(remaining.length).toBe(2)
  })

  it('handles empty document list gracefully', async () => {
    const deps = makeDeps(memdirStore)
    const worker = createAutoDreamWorker(deps)
    const result = await worker.run()

    expect(result.merged).toBe(0)
    expect(result.pruned).toBe(0)
    expect(result.updated).toBe(0)
  })

  it('skips consolidation when doc count is below threshold', async () => {
    // Only one document — not enough to consolidate
    await memdirStore.putDocument(makeDoc({ source: 'extraction' }))

    const deps = makeDeps(memdirStore)
    const worker = createAutoDreamWorker(deps)
    const result = await worker.run()

    expect(result.skipped).toBe(true)
    expect(deps.runConsolidationModel).not.toHaveBeenCalled()
  })

  it('applies updates from the model to existing docs', async () => {
    const doc = makeDoc({
      id: 'update-target',
      type: 'character',
      title: 'Bob',
      description: 'Bob is angry',
      source: 'extraction',
    })
    await memdirStore.putDocument(doc)

    // Need a second doc to exceed consolidation threshold
    await memdirStore.putDocument(
      makeDoc({ id: 'filler', source: 'extraction' }),
    )

    const deps = makeDeps(memdirStore, {
      runConsolidationModel: vi.fn(async () =>
        JSON.stringify({
          merges: [],
          prunes: [],
          updates: [
            {
              id: 'update-target',
              description: 'Bob is now calm',
              freshness: 'current',
            },
          ],
        }),
      ),
    })

    const worker = createAutoDreamWorker(deps)
    const result = await worker.run()

    expect(result.updated).toBeGreaterThan(0)
    const updated = await memdirStore.getDocument('update-target')
    expect(updated).not.toBeNull()
    expect(updated!.description).toBe('Bob is now calm')
  })

  it('only processes extraction/dream-sourced docs by default', async () => {
    // Mix of sources
    await memdirStore.putDocument(
      makeDoc({ id: 'ext-1', source: 'extraction' }),
    )
    await memdirStore.putDocument(
      makeDoc({ id: 'ext-2', source: 'extraction' }),
    )
    await memdirStore.putDocument(
      makeDoc({ id: 'op-1', source: 'operator' }),
    )
    await memdirStore.putDocument(
      makeDoc({ id: 'man-1', source: 'manual' }),
    )

    const modelFn = vi.fn(async () =>
      JSON.stringify({ merges: [], prunes: [], updates: [] }),
    )
    const deps = makeDeps(memdirStore, { runConsolidationModel: modelFn })

    const worker = createAutoDreamWorker(deps)
    await worker.run()

    // The model should have been called, and the prompt should only
    // reference extraction/dream docs
    expect(modelFn).toHaveBeenCalledTimes(1)
    const prompt = String((modelFn.mock.calls as unknown[][])[0]?.[0] ?? '')
    // operator and manual docs should not be in the consolidation prompt
    expect(prompt).not.toContain('op-1')
    expect(prompt).not.toContain('man-1')
    // extraction docs should be in the prompt
    expect(prompt).toContain('ext-1')
    expect(prompt).toContain('ext-2')
  })

  it('stages: orient → gather → consolidate → prune', async () => {
    // Verify the worker uses a staged approach by tracking calls
    const doc1 = makeDoc({ id: 's-1', source: 'extraction', type: 'plot' })
    const doc2 = makeDoc({ id: 's-2', source: 'extraction', type: 'plot' })
    await memdirStore.putDocument(doc1)
    await memdirStore.putDocument(doc2)

    const callLog: string[] = []
    const deps = makeDeps(memdirStore, {
      log: vi.fn((msg: string) => callLog.push(msg)),
      runConsolidationModel: vi.fn(async () =>
        JSON.stringify({ merges: [], prunes: [], updates: [] }),
      ),
    })

    const worker = createAutoDreamWorker(deps)
    await worker.run()

    // Verify staged execution is logged
    expect(callLog.some((m) => m.includes('orient'))).toBe(true)
    expect(callLog.some((m) => m.includes('gather'))).toBe(true)
    expect(callLog.some((m) => m.includes('consolidate'))).toBe(true)
    expect(callLog.some((m) => m.includes('prune'))).toBe(true)
  })

  it('does not call model when no consolidation-eligible docs exist', async () => {
    // Only operator/manual docs
    await memdirStore.putDocument(
      makeDoc({ id: 'op-only', source: 'operator' }),
    )

    const modelFn = vi.fn(async () =>
      JSON.stringify({ merges: [], prunes: [], updates: [] }),
    )
    const deps = makeDeps(memdirStore, { runConsolidationModel: modelFn })

    const worker = createAutoDreamWorker(deps)
    const result = await worker.run()

    expect(result.skipped).toBe(true)
    expect(modelFn).not.toHaveBeenCalled()
  })

  it('update does not resurrect a merged source doc', async () => {
    const doc1 = makeDoc({
      id: 'merge-src-1',
      type: 'character',
      title: 'Alice',
      description: 'Alice v1',
      source: 'extraction',
    })
    const doc2 = makeDoc({
      id: 'merge-src-2',
      type: 'character',
      title: 'Alice',
      description: 'Alice v2',
      source: 'extraction',
    })
    await memdirStore.putDocument(doc1)
    await memdirStore.putDocument(doc2)

    // Model returns merge + overlapping update on a source doc
    const deps = makeDeps(memdirStore, {
      runConsolidationModel: vi.fn(async () =>
        JSON.stringify({
          merges: [
            {
              sourceIds: ['merge-src-1', 'merge-src-2'],
              mergedDoc: {
                type: 'character',
                title: 'Alice (merged)',
                description: 'Alice combined',
                tags: [],
              },
            },
          ],
          prunes: [],
          updates: [
            { id: 'merge-src-1', description: 'Should not resurrect' },
          ],
        }),
      ),
    })

    const worker = createAutoDreamWorker(deps)
    const result = await worker.run()

    expect(result.merged).toBe(2)
    // The update should be skipped, not applied
    expect(result.updated).toBe(0)

    const remaining = await memdirStore.listDocuments()
    expect(remaining.length).toBe(1)
    expect(remaining[0]!.title).toBe('Alice (merged)')
  })

  it('update does not resurrect a pruned doc', async () => {
    const doc1 = makeDoc({
      id: 'prune-target',
      type: 'plot',
      title: 'Old event',
      description: 'Stale content',
      source: 'extraction',
    })
    const doc2 = makeDoc({
      id: 'keep-me',
      type: 'plot',
      title: 'Current event',
      description: 'Fresh content',
      source: 'extraction',
    })
    await memdirStore.putDocument(doc1)
    await memdirStore.putDocument(doc2)

    // Model returns prune + overlapping update on the pruned doc
    const deps = makeDeps(memdirStore, {
      runConsolidationModel: vi.fn(async () =>
        JSON.stringify({
          merges: [],
          prunes: ['prune-target'],
          updates: [
            { id: 'prune-target', description: 'Should not resurrect' },
          ],
        }),
      ),
    })

    const worker = createAutoDreamWorker(deps)
    const result = await worker.run()

    expect(result.pruned).toBe(1)
    expect(result.updated).toBe(0)

    const remaining = await memdirStore.listDocuments()
    expect(remaining.length).toBe(1)
    expect(remaining[0]!.id).toBe('keep-me')
  })

  it('refuses to prune migration-sourced docs', async () => {
    const migrationDoc = makeDoc({
      id: 'mig-1',
      type: 'character',
      title: 'Migrated entity',
      description: 'Came from canonical migration',
      source: 'migration',
    })
    // Need eligible docs so the model is actually called
    await memdirStore.putDocument(makeDoc({ id: 'ext-a', source: 'extraction' }))
    await memdirStore.putDocument(makeDoc({ id: 'ext-b', source: 'extraction' }))
    await memdirStore.putDocument(migrationDoc)

    const deps = makeDeps(memdirStore, {
      runConsolidationModel: vi.fn(async () =>
        JSON.stringify({
          merges: [],
          prunes: ['mig-1'],
          updates: [],
        }),
      ),
    })

    const worker = createAutoDreamWorker(deps)
    const result = await worker.run()

    expect(result.pruned).toBe(0)
    const remaining = await memdirStore.listDocuments()
    expect(remaining.find((d) => d.id === 'mig-1')).toBeDefined()
  })

  it('refuses to merge migration-sourced docs', async () => {
    const migrationDoc = makeDoc({
      id: 'mig-merge',
      type: 'character',
      title: 'Migrated',
      description: 'From canonical',
      source: 'migration',
    })
    await memdirStore.putDocument(makeDoc({ id: 'ext-c', source: 'extraction' }))
    await memdirStore.putDocument(makeDoc({ id: 'ext-d', source: 'extraction' }))
    await memdirStore.putDocument(migrationDoc)

    const deps = makeDeps(memdirStore, {
      runConsolidationModel: vi.fn(async () =>
        JSON.stringify({
          merges: [
            {
              sourceIds: ['ext-c', 'mig-merge'],
              mergedDoc: {
                type: 'character',
                title: 'Merged',
                description: 'Should not happen',
                tags: [],
              },
            },
          ],
          prunes: [],
          updates: [],
        }),
      ),
    })

    const worker = createAutoDreamWorker(deps)
    const result = await worker.run()

    expect(result.merged).toBe(0)
    const remaining = await memdirStore.listDocuments()
    expect(remaining.find((d) => d.id === 'mig-merge')).toBeDefined()
  })

  it('creates merged doc before removing sources (safe ordering)', async () => {
    const doc1 = makeDoc({
      id: 'order-1',
      type: 'character',
      title: 'X',
      description: 'X desc',
      source: 'extraction',
    })
    const doc2 = makeDoc({
      id: 'order-2',
      type: 'character',
      title: 'X',
      description: 'X alt',
      source: 'extraction',
    })
    await memdirStore.putDocument(doc1)
    await memdirStore.putDocument(doc2)

    // Track the order of put vs remove calls
    const opLog: string[] = []
    const origPut = memdirStore.putDocument.bind(memdirStore)
    const origRemove = memdirStore.removeDocument.bind(memdirStore)

    vi.spyOn(memdirStore, 'putDocument').mockImplementation(async (doc) => {
      opLog.push(`put:${doc.id}`)
      return origPut(doc)
    })
    vi.spyOn(memdirStore, 'removeDocument').mockImplementation(async (id) => {
      opLog.push(`remove:${id}`)
      return origRemove(id)
    })

    const deps = makeDeps(memdirStore, {
      runConsolidationModel: vi.fn(async () =>
        JSON.stringify({
          merges: [
            {
              sourceIds: ['order-1', 'order-2'],
              mergedDoc: {
                type: 'character',
                title: 'X merged',
                description: 'X combined',
                tags: [],
              },
            },
          ],
          prunes: [],
          updates: [],
        }),
      ),
    })

    const worker = createAutoDreamWorker(deps)
    await worker.run()

    // The merged doc put should come before any source removal
    const putIdx = opLog.findIndex((o) => o.startsWith('put:dream-merged-'))
    const removeIdx1 = opLog.indexOf('remove:order-1')
    const removeIdx2 = opLog.indexOf('remove:order-2')
    expect(putIdx).toBeGreaterThanOrEqual(0)
    expect(removeIdx1).toBeGreaterThan(putIdx)
    expect(removeIdx2).toBeGreaterThan(putIdx)
  })

  // ── JSON repair integration ──────────────────────────────────────────

  it('parses fenced consolidation model response', async () => {
    const doc1 = makeDoc({ id: 'fence-1', source: 'extraction' })
    const doc2 = makeDoc({ id: 'fence-2', source: 'extraction' })
    await memdirStore.putDocument(doc1)
    await memdirStore.putDocument(doc2)

    const responseJson = JSON.stringify({
      merges: [],
      prunes: ['fence-1'],
      updates: [],
    })

    const deps = makeDeps(memdirStore, {
      runConsolidationModel: vi.fn(async () =>
        `\`\`\`json\n${responseJson}\n\`\`\``
      ),
    })

    const worker = createAutoDreamWorker(deps)
    const result = await worker.run()

    expect(result.pruned).toBe(1)
    const remaining = await memdirStore.listDocuments()
    expect(remaining.find((d) => d.id === 'fence-1')).toBeUndefined()
  })

  it('parses prose-wrapped consolidation response with trailing commas', async () => {
    const doc1 = makeDoc({ id: 'prose-1', source: 'extraction' })
    const doc2 = makeDoc({ id: 'prose-2', source: 'extraction' })
    await memdirStore.putDocument(doc1)
    await memdirStore.putDocument(doc2)

    const deps = makeDeps(memdirStore, {
      runConsolidationModel: vi.fn(async () =>
        'Here is the consolidation:\n{"merges": [], "prunes": ["prose-1",], "updates": [],}\nDone.'
      ),
    })

    const worker = createAutoDreamWorker(deps)
    const result = await worker.run()

    expect(result.pruned).toBe(1)
  })

  it('handles smart quotes in consolidation response', async () => {
    const doc1 = makeDoc({ id: 'sq-1', source: 'extraction' })
    const doc2 = makeDoc({ id: 'sq-2', source: 'extraction' })
    await memdirStore.putDocument(doc1)
    await memdirStore.putDocument(doc2)

    const deps = makeDeps(memdirStore, {
      runConsolidationModel: vi.fn(async () =>
        '{\u201Cmerges\u201D: [], \u201Cprunes\u201D: [\u201Csq-1\u201D], \u201Cupdates\u201D: []}'
      ),
    })

    const worker = createAutoDreamWorker(deps)
    const result = await worker.run()

    expect(result.pruned).toBe(1)
  })

  it('still skips on truly non-JSON consolidation response', async () => {
    const doc1 = makeDoc({ id: 'garbage-1', source: 'extraction' })
    const doc2 = makeDoc({ id: 'garbage-2', source: 'extraction' })
    await memdirStore.putDocument(doc1)
    await memdirStore.putDocument(doc2)

    const deps = makeDeps(memdirStore, {
      log: vi.fn(),
      runConsolidationModel: vi.fn(async () =>
        'I cannot consolidate these memories right now.'
      ),
    })

    const worker = createAutoDreamWorker(deps)
    const result = await worker.run()

    expect(result.merged).toBe(0)
    expect(result.pruned).toBe(0)
    expect(result.updated).toBe(0)
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('failed to parse'),
    )
  })
})
