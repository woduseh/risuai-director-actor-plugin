import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  createExtractionWorker,
  type ExtractionWorkerDeps,
  type ExtractionContext,
} from '../src/memory/extractMemories.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides?: Partial<ExtractionWorkerDeps>): ExtractionWorkerDeps {
  return {
    runExtraction: vi.fn(async () => ({
      applied: true,
      memoryUpdate: null,
    })),
    persistDocuments: vi.fn(async () => {}),
    log: vi.fn(),
    getLastExtractionTs: vi.fn(async () => 0),
    setLastExtractionTs: vi.fn(async () => {}),
    getLastProcessedCursor: vi.fn(async () => 0),
    setLastProcessedCursor: vi.fn(async () => {}),
    hashRequest: (ctx: ExtractionContext) =>
      `hash-${ctx.turnId}`,
    ...overrides,
  }
}

function makeContext(overrides?: Partial<ExtractionContext>): ExtractionContext {
  return {
    turnId: `turn-${Date.now()}`,
    turnIndex: 1,
    type: 'model',
    content: 'A walks away.',
    messages: [
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Continue.' },
    ],
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
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExtractionWorker', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  test('runs extraction after receiving a finalized turn context', async () => {
    const deps = makeDeps()
    const worker = createExtractionWorker(deps, { extractionMinTurnInterval: 1 })

    const ctx = makeContext({ turnIndex: 1 })
    await worker.submit(ctx)
    await worker.flush()

    expect(deps.runExtraction).toHaveBeenCalledTimes(1)
    expect(deps.runExtraction).toHaveBeenCalledWith(ctx)
  })

  test('skips duplicate extraction when request hash already seen', async () => {
    const seenHashes = new Set<string>()
    const deps = makeDeps({
      hashRequest: (ctx) => `hash-${ctx.turnId}`,
      getLastExtractionTs: vi.fn(async () => 0),
    })
    const worker = createExtractionWorker(deps, {
      extractionMinTurnInterval: 1,
      seenHashes,
    })

    const ctx = makeContext({ turnId: 'dup-turn', turnIndex: 1 })
    seenHashes.add('hash-dup-turn')

    await worker.submit(ctx)
    await worker.flush()

    expect(deps.runExtraction).not.toHaveBeenCalled()
  })

  test('coalesces overlapping triggers into one trailing run', async () => {
    const deps = makeDeps()
    const worker = createExtractionWorker(deps, { extractionMinTurnInterval: 1 })

    // Submit three contexts rapidly — only the last should run
    const ctx1 = makeContext({ turnId: 'c1', turnIndex: 1, content: 'First.' })
    const ctx2 = makeContext({ turnId: 'c2', turnIndex: 2, content: 'Second.' })
    const ctx3 = makeContext({ turnId: 'c3', turnIndex: 3, content: 'Third.' })

    // Submit without awaiting flush between them
    worker.submit(ctx1)
    worker.submit(ctx2)
    worker.submit(ctx3)

    await worker.flush()

    // Only the last submitted context should have been extracted
    expect(deps.runExtraction).toHaveBeenCalledTimes(1)
    expect(deps.runExtraction).toHaveBeenCalledWith(ctx3)
  })

  test('respects extractionMinTurnInterval so extraction does not fire every turn', async () => {
    let cursor = 0
    const deps = makeDeps({
      getLastProcessedCursor: vi.fn(async () => cursor),
      setLastProcessedCursor: vi.fn(async (c: number) => { cursor = c }),
    })
    const worker = createExtractionWorker(deps, { extractionMinTurnInterval: 3 })

    // Turn 1: should run (first extraction ever, cursor was 0)
    await worker.submit(makeContext({ turnIndex: 1, turnId: 't1' }))
    await worker.flush()
    expect(deps.runExtraction).toHaveBeenCalledTimes(1)

    // Turn 2: should NOT run (interval = 3, only 1 turn since last)
    await worker.submit(makeContext({ turnIndex: 2, turnId: 't2' }))
    await worker.flush()
    expect(deps.runExtraction).toHaveBeenCalledTimes(1)

    // Turn 3: should NOT run (only 2 turns since last)
    await worker.submit(makeContext({ turnIndex: 3, turnId: 't3' }))
    await worker.flush()
    expect(deps.runExtraction).toHaveBeenCalledTimes(1)

    // Turn 4: should run (3 turns since cursor=1)
    await worker.submit(makeContext({ turnIndex: 4, turnId: 't4' }))
    await worker.flush()
    expect(deps.runExtraction).toHaveBeenCalledTimes(2)
  })

  test('in-flight guard prevents concurrent extractions', async () => {
    let resolveFirst: (() => void) | null = null
    const extractionOrder: string[] = []

    const deps = makeDeps({
      runExtraction: vi.fn(async (ctx: ExtractionContext) => {
        if (ctx.turnId === 'inf1') {
          await new Promise<void>((resolve) => {
            resolveFirst = resolve
          })
        }
        extractionOrder.push(ctx.turnId)
        return { applied: true, memoryUpdate: null }
      }),
    })
    const worker = createExtractionWorker(deps, { extractionMinTurnInterval: 1 })

    const ctx1 = makeContext({ turnIndex: 1, turnId: 'inf1' })
    const ctx2 = makeContext({ turnIndex: 2, turnId: 'inf2' })

    // Submit first context and start processing via flush
    worker.submit(ctx1)
    const flushPromise = worker.flush()

    // Let microtasks settle so extraction starts
    await new Promise((r) => setTimeout(r, 0))

    // First extraction has started but is blocked
    expect(deps.runExtraction).toHaveBeenCalledTimes(1)

    // Submit second while first is in flight
    worker.submit(ctx2)

    // Second extraction should NOT have started yet
    expect(deps.runExtraction).toHaveBeenCalledTimes(1)

    // Complete the first extraction — drain loop picks up ctx2
    resolveFirst!()
    await flushPromise

    expect(deps.runExtraction).toHaveBeenCalledTimes(2)
    expect(extractionOrder).toEqual(['inf1', 'inf2'])
  })

  test('persists documents after successful extraction', async () => {
    const deps = makeDeps({
      runExtraction: vi.fn(async () => ({
        applied: true,
        memoryUpdate: {
          status: 'pass' as const,
          turnScore: 0.8,
          violations: [],
          durableFacts: ['A is gone.'],
          sceneDelta: {},
          entityUpdates: [],
          relationUpdates: [],
          memoryOps: [],
        },
      })),
    })
    const worker = createExtractionWorker(deps, { extractionMinTurnInterval: 1 })

    await worker.submit(makeContext({ turnIndex: 1 }))
    await worker.flush()

    expect(deps.persistDocuments).toHaveBeenCalledTimes(1)
  })

  test('updates last-processed cursor after successful extraction', async () => {
    let cursor = 0
    const deps = makeDeps({
      getLastProcessedCursor: vi.fn(async () => cursor),
      setLastProcessedCursor: vi.fn(async (c: number) => { cursor = c }),
    })
    const worker = createExtractionWorker(deps, { extractionMinTurnInterval: 1 })

    await worker.submit(makeContext({ turnIndex: 5 }))
    await worker.flush()

    expect(cursor).toBe(5)
  })

  test('records seen hash after extraction to prevent re-processing', async () => {
    const seenHashes = new Set<string>()
    const deps = makeDeps()
    const worker = createExtractionWorker(deps, {
      extractionMinTurnInterval: 1,
      seenHashes,
    })

    const ctx = makeContext({ turnId: 'unique-turn', turnIndex: 1 })
    await worker.submit(ctx)
    await worker.flush()

    expect(seenHashes.has('hash-unique-turn')).toBe(true)
  })

  test('logs error and continues when extraction fails', async () => {
    const deps = makeDeps({
      runExtraction: vi.fn(async () => {
        throw new Error('LLM timeout')
      }),
    })
    const worker = createExtractionWorker(deps, { extractionMinTurnInterval: 1 })

    await worker.submit(makeContext({ turnIndex: 1 }))
    await worker.flush()

    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('LLM timeout'),
    )
  })
})
