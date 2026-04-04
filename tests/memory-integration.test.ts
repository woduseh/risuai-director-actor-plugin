/**
 * End-to-end integration test for the Claude-style memory lifecycle:
 *   extract → recall → session-memory → dream
 *
 * Proves that these subsystems compose without shared-state conflicts
 * when the memdir migration gate is active.
 */
import { vi } from 'vitest'
import { CanonicalStore } from '../src/memory/canonicalStore.js'
import { MemdirStore } from '../src/memory/memdirStore.js'
import { createExtractionWorker } from '../src/memory/extractMemories.js'
import type { ExtractionContext, ExtractionResult, ExtractionWorkerDeps } from '../src/memory/extractMemories.js'
import { findRelevantMemories, RecallCache } from '../src/memory/findRelevantMemories.js'
import { SessionNotebook, formatNotebookBlock } from '../src/memory/sessionMemory.js'
import { createAutoDreamWorker } from '../src/memory/autoDream.js'
import { buildMemoryMd, migrateCanonicalToMemdir } from '../src/memory/memoryDocuments.js'
import { createEmptyState } from '../src/contracts/types.js'
import type { MemdirDocument, MemoryUpdate } from '../src/contracts/types.js'
import { InMemoryAsyncStore } from './helpers/mockRisuai.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMemdirDoc(overrides: Partial<MemdirDocument> & { id: string }): MemdirDocument {
  return {
    type: 'continuity',
    title: `Doc ${overrides.id}`,
    description: `Description for ${overrides.id}`,
    scopeKey: 'scope:int-test',
    updatedAt: Date.now(),
    source: 'extraction',
    freshness: 'current',
    tags: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Integration: full extract → recall → session → dream lifecycle
// ---------------------------------------------------------------------------

describe('Memory lifecycle integration', () => {
  test('extract → recall → session → dream completes without shared-state conflicts', async () => {
    const storage = new InMemoryAsyncStore()
    const scopeKey = 'scope:lifecycle:test'
    const storageKey = `director-plugin-state::${scopeKey}`

    // ── Setup: canonical store with existing memory ────────────────
    const initialState = createEmptyState()
    initialState.memory.entities = [
      { id: 'e-hero', name: 'Hero', facts: ['Brave knight'], updatedAt: 1000 },
    ]
    initialState.memory.worldFacts = [
      { id: 'wf-castle', text: 'The castle stands at the edge of darkness', updatedAt: 1000 },
    ]
    await storage.setItem(storageKey, initialState)

    const memdirStore = new MemdirStore(storage, scopeKey)
    const canonStore = new CanonicalStore(storage, {
      storageKey,
      memdirStore,
    })

    // Load triggers migration
    const state = await canonStore.load()
    expect(state.memory.entities).toHaveLength(1)

    // Verify migration populated memdir
    const migratedDocs = await memdirStore.listDocuments()
    expect(migratedDocs.length).toBeGreaterThan(0)

    // ── Phase 1: Extraction ─────────────────────────────────────────
    // Simulate extraction worker persisting a new document
    const extractedDoc = makeMemdirDoc({
      id: 'extracted-1',
      type: 'plot',
      title: 'Hero enters the castle',
      description: 'The hero walked through the gates at dusk.',
      source: 'extraction',
    })
    await memdirStore.putDocument(extractedDoc)

    const docsAfterExtraction = await memdirStore.listDocuments()
    const extractedFound = docsAfterExtraction.find((d) => d.id === 'extracted-1')
    expect(extractedFound).toBeDefined()

    // ── Phase 2: Recall ─────────────────────────────────────────────
    const allDocs = await memdirStore.listDocuments()
    const memoryMd = buildMemoryMd(allDocs, { tokenBudget: 2000 })

    const recallResult = await findRelevantMemories(
      {
        runRecallModel: async () => ({
          ok: true,
          text: JSON.stringify(['extracted-1', extractedFound!.id]),
        }),
        log: () => {},
      },
      {
        docs: allDocs,
        recentText: 'The hero approached the castle',
        memoryMdContent: memoryMd,
        maxResults: 3,
      },
    )

    expect(recallResult.source).toBe('recall')
    expect(recallResult.selectedDocs.length).toBeGreaterThan(0)

    // ── Phase 3: Session notebook ───────────────────────────────────
    const notebook = new SessionNotebook(scopeKey, { turnThreshold: 1, tokenThreshold: 50 })
    notebook.recordTurn(100) // enough to meet threshold
    const accepted = notebook.tryUpdate({
      currentState: 'Hero is at the castle gates.',
      immediateGoals: 'Enter the castle.',
    })
    expect(accepted).toBe(true)

    const snap = notebook.snapshot()
    const block = formatNotebookBlock(snap)
    expect(block).toContain('Hero is at the castle gates')
    expect(block).toContain('Enter the castle')

    // ── Phase 4: Dream/consolidation ────────────────────────────────
    // Add another extraction doc so dream has enough eligible docs
    await memdirStore.putDocument(
      makeMemdirDoc({
        id: 'extracted-2',
        type: 'continuity',
        title: 'Castle gate was unlocked',
        description: 'The gate was found unlocked, suggesting a trap.',
        source: 'extraction',
      }),
    )

    const dreamWorker = createAutoDreamWorker({
      memdirStore,
      log: () => {},
      async runConsolidationModel() {
        return JSON.stringify({
          merges: [],
          prunes: [],
          updates: [
            { id: 'extracted-2', freshness: 'stale' },
          ],
        })
      },
    })

    const dreamResult = await dreamWorker.run()
    expect(dreamResult.skipped).toBe(false)
    expect(dreamResult.updated).toBe(1)

    // ── Verify no shared-state conflicts ────────────────────────────
    // Canonical state is unchanged (migration is non-destructive)
    const finalCanonical = canonStore.snapshot()
    expect(finalCanonical.memory.entities).toHaveLength(1)
    expect(finalCanonical.memory.entities[0]!.name).toBe('Hero')

    // Memdir docs are independent and updated correctly
    const finalDocs = await memdirStore.listDocuments()
    const updatedDoc = finalDocs.find((d) => d.id === 'extracted-2')
    expect(updatedDoc).toBeDefined()
    expect(updatedDoc!.freshness).toBe('stale')

    // Session notebook is independent — no cross-contamination
    const finalSnap = notebook.snapshot()
    expect(finalSnap.currentState).toBe('Hero is at the castle gates.')
  })

  test('migration + extraction worker: new extractions go to memdir without corrupting canonical', async () => {
    const storage = new InMemoryAsyncStore()
    const scopeKey = 'scope:extract-compat:test'
    const storageKey = `director-plugin-state::${scopeKey}`

    const state = createEmptyState()
    state.memory.entities = [
      { id: 'e-1', name: 'Elf', facts: ['Ancient'], updatedAt: 1000 },
    ]
    await storage.setItem(storageKey, state)

    const memdirStore = new MemdirStore(storage, scopeKey)
    const canonStore = new CanonicalStore(storage, {
      storageKey,
      memdirStore,
    })

    await canonStore.load()

    // Create extraction worker that persists to memdir
    let lastExtractionTs = 0
    let lastCursor = 0
    const deps: ExtractionWorkerDeps = {
      async runExtraction(): Promise<ExtractionResult> {
        return {
          applied: true,
          memoryUpdate: {
            status: 'pass',
            turnScore: 0.9,
            violations: [],
            durableFacts: ['Elf found a hidden path'],
            sceneDelta: {},
            entityUpdates: [],
            relationUpdates: [],
            memoryOps: [],
          },
        }
      },
      async persistDocuments(update: MemoryUpdate) {
        await memdirStore.putDocument(
          makeMemdirDoc({
            id: `extracted-${Date.now()}`,
            type: 'continuity',
            title: update.durableFacts[0] ?? 'fact',
            description: update.durableFacts.join('; '),
          }),
        )
      },
      log: () => {},
      async getLastExtractionTs() { return lastExtractionTs },
      async setLastExtractionTs(ts) { lastExtractionTs = ts },
      async getLastProcessedCursor() { return lastCursor },
      async setLastProcessedCursor(c) { lastCursor = c },
      hashRequest(ctx) { return `hash-${ctx.turnId}` },
    }

    const worker = createExtractionWorker(deps, {
      extractionMinTurnInterval: 1,
    })

    const ctx: ExtractionContext = {
      turnId: 'turn-42',
      turnIndex: 5,
      type: 'model',
      content: 'Elf navigates a hidden path',
      messages: [{ role: 'user', content: 'Where does the elf go?' }],
      brief: {
        confidence: 0.9,
        pacing: 'steady',
        beats: [],
        continuityLocks: [],
        ensembleWeights: {},
        styleInheritance: {},
        forbiddenMoves: [],
        memoryHints: [],
      },
    }

    await worker.submit(ctx)
    await worker.flush()

    // Memdir now has migrated docs + the new extraction
    const allDocs = await memdirStore.listDocuments()
    const extractedDocs = allDocs.filter((d) => d.source === 'extraction')
    expect(extractedDocs.length).toBeGreaterThanOrEqual(1)

    // Canonical state was NOT mutated by extraction
    const canonSnap = canonStore.snapshot()
    expect(canonSnap.memory.entities).toHaveLength(1)
    expect(canonSnap.memory.entities[0]!.name).toBe('Elf')
  })
})

// ---------------------------------------------------------------------------
// Integration: embedding on persist and refresh
// ---------------------------------------------------------------------------

describe('Embedding integration', () => {
  test('embedDocuments embeds docs and attaches vector metadata', async () => {
    const { embedDocuments, computeEmbeddingCacheStatus } = await import('../src/memory/embeddingIntegration.js')

    const storage = new InMemoryAsyncStore()
    const scopeKey = 'scope:embed:test'
    const memdirStore = new MemdirStore(storage, scopeKey)

    // Add docs without embeddings
    await memdirStore.putDocument(makeMemdirDoc({
      id: 'doc-1',
      title: 'Hero',
      description: 'A brave hero',
    }))
    await memdirStore.putDocument(makeMemdirDoc({
      id: 'doc-2',
      title: 'Villain',
      description: 'An evil villain',
    }))

    const mockClient = {
      embed: vi.fn(async () => ({ ok: true as const, vector: [0.1, 0.2, 0.3] })),
      embedBatch: vi.fn(async (texts: string[]) =>
        texts.map(() => ({ ok: true as const, vector: [0.1, 0.2, 0.3] })),
      ),
    }

    const count = await embedDocuments({
      memdirStore,
      embeddingClient: mockClient,
      vectorVersion: 'emb-test-v1',
      log: () => {},
    })

    expect(count).toBe(2)

    const docs = await memdirStore.listDocuments()
    for (const doc of docs) {
      expect(doc.embedding).toBeDefined()
      expect(doc.embedding!.version).toBe('emb-test-v1')
      expect(doc.embedding!.vector).toEqual([0.1, 0.2, 0.3])
    }
  })

  test('embedDocuments skips docs already at current version', async () => {
    const { embedDocuments } = await import('../src/memory/embeddingIntegration.js')

    const storage = new InMemoryAsyncStore()
    const scopeKey = 'scope:embed:skip'
    const memdirStore = new MemdirStore(storage, scopeKey)

    await memdirStore.putDocument({
      ...makeMemdirDoc({ id: 'doc-1', title: 'Already embedded' }),
      embedding: { vector: [0.5], version: 'emb-v1', embeddedAt: Date.now() },
    })

    const mockClient = {
      embed: vi.fn(async () => ({ ok: true as const, vector: [0.9] })),
      embedBatch: vi.fn(async () => []),
    }

    const count = await embedDocuments({
      memdirStore,
      embeddingClient: mockClient,
      vectorVersion: 'emb-v1',
      log: () => {},
    })

    expect(count).toBe(0)
    expect(mockClient.embed).not.toHaveBeenCalled()
  })

  test('computeEmbeddingCacheStatus calculates ready/stale/missing counts', async () => {
    const { computeEmbeddingCacheStatus } = await import('../src/memory/embeddingIntegration.js')

    const docs: MemdirDocument[] = [
      {
        ...makeMemdirDoc({ id: 'd1' }),
        embedding: { vector: [0.1], version: 'emb-v2', embeddedAt: 1 },
      },
      {
        ...makeMemdirDoc({ id: 'd2' }),
        embedding: { vector: [0.2], version: 'emb-v1', embeddedAt: 1 },
      },
      makeMemdirDoc({ id: 'd3' }),
    ]

    const status = computeEmbeddingCacheStatus(docs, 'emb-v2', true, true)
    expect(status.readyCount).toBe(1)
    expect(status.staleCount).toBe(1)
    expect(status.missingCount).toBe(1)
    expect(status.enabled).toBe(true)
    expect(status.supported).toBe(true)
    expect(status.currentVersion).toBe('emb-v2')
  })

  test('computeEmbeddingCacheStatus returns disabled status when embeddings off', async () => {
    const { computeEmbeddingCacheStatus } = await import('../src/memory/embeddingIntegration.js')

    const status = computeEmbeddingCacheStatus([], '', false, true)
    expect(status.enabled).toBe(false)
    expect(status.supported).toBe(true)
    expect(status.readyCount).toBe(0)
  })

  test('computeEmbeddingCacheStatus reflects unsupported provider', async () => {
    const { computeEmbeddingCacheStatus } = await import('../src/memory/embeddingIntegration.js')

    const status = computeEmbeddingCacheStatus([], 'v1', true, false)
    expect(status.supported).toBe(false)
    expect(status.enabled).toBe(true)
  })
})
