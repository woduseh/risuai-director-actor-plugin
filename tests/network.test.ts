import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  createBackgroundHousekeeping,
  type HousekeepingDeps,
} from '../src/runtime/backgroundHousekeeping.js'
import type { ExtractionContext } from '../src/memory/extractMemories.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides?: Partial<HousekeepingDeps>): HousekeepingDeps {
  return {
    submitExtraction: vi.fn(async () => {}),
    flushExtraction: vi.fn(async () => {}),
    getExtractionMinTurnInterval: () => 3,
    log: vi.fn(),
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

describe('backgroundHousekeeping', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  test('afterTurn submits extraction context to the worker', async () => {
    const deps = makeDeps()
    const hk = createBackgroundHousekeeping(deps)

    const ctx = makeContext({ turnIndex: 1 })
    await hk.afterTurn(ctx)

    expect(deps.submitExtraction).toHaveBeenCalledTimes(1)
    expect(deps.submitExtraction).toHaveBeenCalledWith(ctx)
  })

  test('coalesces rapid afterTurn calls so only the last context is submitted', async () => {
    vi.useFakeTimers()
    const deps = makeDeps()
    const hk = createBackgroundHousekeeping(deps)

    const ctx1 = makeContext({ turnId: 'h1', turnIndex: 1 })
    const ctx2 = makeContext({ turnId: 'h2', turnIndex: 2 })
    const ctx3 = makeContext({ turnId: 'h3', turnIndex: 3 })

    // Rapid fire - no await between them
    hk.afterTurn(ctx1)
    hk.afterTurn(ctx2)
    hk.afterTurn(ctx3)

    await vi.advanceTimersByTimeAsync(50)

    // The housekeeping layer coalesces so only one submit goes through
    expect(deps.submitExtraction).toHaveBeenCalledTimes(1)
    const lastCall = (deps.submitExtraction as ReturnType<typeof vi.fn>).mock.calls[0]![0] as ExtractionContext
    expect(lastCall.turnId).toBe('h3')

    vi.useRealTimers()
  })

  test('shutdown flushes pending extraction', async () => {
    const deps = makeDeps()
    const hk = createBackgroundHousekeeping(deps)

    await hk.shutdown()

    expect(deps.flushExtraction).toHaveBeenCalledTimes(1)
  })

  test('logs when afterTurn submission throws', async () => {
    const deps = makeDeps({
      submitExtraction: vi.fn(async () => {
        throw new Error('storage full')
      }),
    })
    const hk = createBackgroundHousekeeping(deps)

    await hk.afterTurn(makeContext())

    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('storage full'),
    )
  })
})
