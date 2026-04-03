import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  createBackgroundHousekeeping,
  type HousekeepingDeps,
  type DreamHousekeepingDeps,
} from '../src/runtime/backgroundHousekeeping.js'
import { makeRecallRequest, isTransientError, withRetry } from '../src/runtime/network.js'
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

// ---------------------------------------------------------------------------
// isTransientError — status-aware transient detection
// ---------------------------------------------------------------------------

describe('isTransientError', () => {
  test('identifies 429 rate limit errors as transient', () => {
    expect(isTransientError(new Error('HTTP 429 Too Many Requests'))).toBe(true)
  })

  test('identifies 502/503/504 gateway errors as transient', () => {
    expect(isTransientError(new Error('502 Bad Gateway'))).toBe(true)
    expect(isTransientError(new Error('503 Service Unavailable'))).toBe(true)
    expect(isTransientError(new Error('504 Gateway Timeout'))).toBe(true)
  })

  test('identifies 524 timeout as transient', () => {
    expect(isTransientError(new Error('524 A Timeout Occurred'))).toBe(true)
  })

  test('identifies rate limit wording as transient', () => {
    expect(isTransientError(new Error('rate limit exceeded'))).toBe(true)
    expect(isTransientError('rate limited')).toBe(true)
  })

  test('identifies timeout and overloaded wording as transient', () => {
    expect(isTransientError(new Error('request timeout'))).toBe(true)
    expect(isTransientError(new Error('server overloaded'))).toBe(true)
  })

  test('does not flag non-transient errors', () => {
    expect(isTransientError(new Error('invalid API key'))).toBe(false)
    expect(isTransientError(new Error('authentication failed'))).toBe(false)
    expect(isTransientError(new Error('permission denied'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// withRetry — exponential backoff retry helper
// ---------------------------------------------------------------------------

describe('withRetry', () => {
  test('returns result on first success without retrying', async () => {
    const fn = vi.fn(async () => 'ok')
    const result = await withRetry(fn, { baseDelayMs: 0 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('retries on transient error and succeeds on later attempt', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls <= 2) throw new Error('503 Service Unavailable')
      return 'recovered'
    })

    const result = await withRetry(fn, { baseDelayMs: 0 })
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  test('does not retry non-transient errors', async () => {
    const fn = vi.fn(async () => {
      throw new Error('invalid API key')
    })

    await expect(withRetry(fn, { baseDelayMs: 0 })).rejects.toThrow('invalid API key')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('throws after exhausting all retries', async () => {
    const fn = vi.fn(async () => {
      throw new Error('429 Too Many Requests')
    })

    await expect(
      withRetry(fn, { baseDelayMs: 0, maxRetries: 2 }),
    ).rejects.toThrow('429')
    expect(fn).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })

  test('calls log callback on each retry attempt', async () => {
    const logFn = vi.fn()
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls === 1) throw new Error('503 Service Unavailable')
      return 'ok'
    })

    await withRetry(fn, { baseDelayMs: 0, log: logFn })
    expect(logFn).toHaveBeenCalledTimes(1)
    expect(logFn).toHaveBeenCalledWith(expect.stringContaining('503'))
  })

  test('respects custom isRetryable predicate', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls === 1) throw new Error('custom transient')
      return 'ok'
    })

    const result = await withRetry(fn, {
      baseDelayMs: 0,
      isRetryable: (err) => String(err).includes('custom transient'),
    })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
