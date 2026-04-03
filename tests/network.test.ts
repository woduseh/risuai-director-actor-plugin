import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  createBackgroundHousekeeping,
  type HousekeepingDeps,
  type DreamHousekeepingDeps,
} from '../src/runtime/backgroundHousekeeping.js'
import { makeRecallRequest } from '../src/runtime/network.js'
import type { DreamCadenceGate, DreamResult } from '../src/memory/autoDream.js'
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

  test('tryDream reads fresh settings via async buildCadenceGate', async () => {
    const deps = makeDeps()

    // Simulate settings that change between calls
    let dreamEnabled = false
    const dreamRunFn = vi.fn(async (): Promise<DreamResult> => ({
      merged: 1,
      pruned: 0,
      updated: 0,
      skipped: false,
    }))

    const dreamDeps: DreamHousekeepingDeps = {
      async buildCadenceGate(): Promise<DreamCadenceGate> {
        // Reads "live" value — simulates store.load()
        return {
          enabled: dreamEnabled,
          lastDreamTs: 0,
          dreamMinHoursElapsed: 0,
          turnsSinceLastDream: 100,
          dreamMinTurnsElapsed: 1,
          sessionsSinceLastDream: 100,
          dreamMinSessionsElapsed: 1,
          userInteractionGuardMs: 0,
          lastUserInteractionTs: 0,
        }
      },
      dreamWorker: {
        shouldRun: (gate: DreamCadenceGate) => gate.enabled,
        run: dreamRunFn,
      },
      consolidationLock: {
        withLock: async <T>(fn: () => Promise<T>) => fn(),
      } as any,
      onDreamComplete: vi.fn(async () => {}),
      log: vi.fn(),
    }

    const hk = createBackgroundHousekeeping(deps, dreamDeps)

    // First call — disabled, dream should NOT run
    const r1 = await hk.tryDream()
    expect(r1).toBeNull()
    expect(dreamRunFn).not.toHaveBeenCalled()

    // "Dashboard changes" enable dream
    dreamEnabled = true

    // Second call — enabled, dream SHOULD run without restart
    const r2 = await hk.tryDream()
    expect(r2).not.toBeNull()
    expect(dreamRunFn).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// makeRecallRequest — host-safe recall model routing
// ---------------------------------------------------------------------------

describe('makeRecallRequest', () => {
  test('routes recall through host runLLMModel abstraction', async () => {
    const mockApi = {
      runLLMModel: vi.fn(async () => ({
        type: 'success' as const,
        result: '["doc-1","doc-2"]',
      })),
    }

    const result = await makeRecallRequest(
      mockApi as any,
      'ID: doc-1 | Type: character | Title: Alice',
      'Alice opened the gate',
    )

    expect(mockApi.runLLMModel).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    expect(result.text).toBe('["doc-1","doc-2"]')
  })

  test('sends system + user messages to runLLMModel', async () => {
    const mockApi = {
      runLLMModel: vi.fn(async () => ({
        type: 'success' as const,
        result: '[]',
      })),
    }

    await makeRecallRequest(mockApi as any, 'manifest', 'query')

    const call = (mockApi.runLLMModel.mock.calls as any[][])[0]?.[0] as any
    expect(call.messages).toHaveLength(2)
    expect(call.messages[0].role).toBe('system')
    expect(call.messages[1].role).toBe('user')
    expect(call.messages[1].content).toContain('manifest')
    expect(call.messages[1].content).toContain('query')
  })

  test('passes model and mode options to runLLMModel', async () => {
    const mockApi = {
      runLLMModel: vi.fn(async () => ({
        type: 'success' as const,
        result: '[]',
      })),
    }

    await makeRecallRequest(mockApi as any, 'manifest', 'query', {
      model: 'gpt-4.1-mini',
      mode: 'otherAx',
    })

    const call = (mockApi.runLLMModel.mock.calls as any[][])[0]?.[0] as any
    expect(call.staticModel).toBe('gpt-4.1-mini')
    expect(call.mode).toBe('otherAx')
  })

  test('returns failure when LLM call fails', async () => {
    const mockApi = {
      runLLMModel: vi.fn(async () => ({
        type: 'fail' as const,
        result: 'rate limited',
      })),
    }

    const result = await makeRecallRequest(mockApi as any, 'manifest', 'query')

    expect(result.ok).toBe(false)
    expect(result.text).toContain('rate limited')
  })
})
