import { vi } from 'vitest'
import { bootstrapPlugin } from '../src/runtime/plugin.js'
import type { DirectorPreRequestResult } from '../src/runtime/plugin.js'
import type { MemoryUpdate, SceneBrief } from '../src/contracts/types.js'
import { createMockRisuaiApi } from './helpers/mockRisuai.js'

const makeBrief = (overrides?: Partial<SceneBrief>): SceneBrief => ({
  confidence: 0.95,
  pacing: 'steady',
  beats: [{ goal: 'Escalate', reason: 'Pressure needed' }],
  continuityLocks: ['The ring is still hidden.'],
  ensembleWeights: { A: 1 },
  styleInheritance: { genre: 'mythic' },
  forbiddenMoves: ['Do not reveal the secret.'],
  memoryHints: ['ring'],
  ...overrides
})

const makeUpdate = (overrides?: Partial<MemoryUpdate>): MemoryUpdate => ({
  status: 'pass',
  turnScore: 0.8,
  violations: [],
  durableFacts: ['A sat down.'],
  sceneDelta: { scenePhase: 'aftermath', activeCharacters: ['A'] },
  entityUpdates: [],
  relationUpdates: [],
  memoryOps: [],
  ...overrides
})

/** Wrap a SceneBrief into the DirectorPreRequestResult envelope. */
const makePreResult = (
  brief?: SceneBrief,
  actorMemoryContext?: string,
): DirectorPreRequestResult => ({
  brief: brief ?? makeBrief(),
  ...(actorMemoryContext !== undefined ? { actorMemoryContext } : {}),
})

describe('bootstrapPlugin', () => {
  test('registers hooks and settings UI', async () => {
    const api = createMockRisuaiApi()

    await bootstrapPlugin(api, {
      director: {
        async preRequest() {
          return null
        },
        async postResponse(): Promise<MemoryUpdate | null> {
          return null
        }
      }
    })

    expect(api.__beforeRequestHandlers).toHaveLength(1)
    expect(api.__afterRequestHandlers).toHaveLength(1)
    expect(api.__scriptHandlers.output).toHaveLength(1)
    expect(api.__registerCalls.some((entry) => entry.kind === 'setting')).toBe(true)
    expect(api.__registerCalls.some((entry) => entry.kind === 'button')).toBe(true)
  })

  test('injects director brief during beforeRequest for matching types', async () => {
    const api = createMockRisuaiApi()

    await bootstrapPlugin(api, {
      director: {
        async preRequest(): Promise<DirectorPreRequestResult> {
          return {
            brief: {
              confidence: 0.95,
              pacing: 'tight',
              beats: [{ goal: 'Escalate', reason: 'Pressure needed' }],
              continuityLocks: ['The ring is still hidden.'],
              ensembleWeights: { A: 1 },
              styleInheritance: { genre: 'mythic' },
              forbiddenMoves: ['Do not reveal the secret.'],
              memoryHints: ['ring']
            }
          }
        },
        async postResponse(): Promise<MemoryUpdate | null> {
          return null
        }
      }
    })

    const result = await api.runBeforeRequest([
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Continue.' }
    ])

    expect(result.some((message) => message.content.includes('<director-brief version="1">'))).toBe(true)
  })

  test('debounces streaming output finalization and updates memory once', async () => {
    vi.useFakeTimers()
    const api = createMockRisuaiApi()
    const postResponse = vi.fn<() => Promise<MemoryUpdate | null>>(async () => ({
      status: 'pass',
      turnScore: 0.8,
      violations: [],
      durableFacts: ['A sat down.'],
      sceneDelta: { scenePhase: 'aftermath', activeCharacters: ['A'] },
      entityUpdates: [],
      relationUpdates: [],
      memoryOps: []
    }))

    await bootstrapPlugin(api, {
      director: {
        async preRequest(): Promise<DirectorPreRequestResult> {
          return {
            brief: {
              confidence: 0.95,
              pacing: 'steady',
              beats: [{ goal: 'Escalate', reason: 'Pressure needed' }],
              continuityLocks: ['The ring is still hidden.'],
              ensembleWeights: { A: 1 },
              styleInheritance: { genre: 'mythic' },
              forbiddenMoves: ['Do not reveal the secret.'],
              memoryHints: ['ring']
            }
          }
        },
        postResponse
      }
    })

    await api.runBeforeRequest([
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Continue.' }
    ])
    await api.runOutput('A looks up')
    await api.runOutput('A looks up and sits down.')

    expect(postResponse).toHaveBeenCalledTimes(0)

    await vi.advanceTimersByTimeAsync(401)

    expect(postResponse).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  test('returns original messages when preRequest returns null', async () => {
    const api = createMockRisuaiApi()

    await bootstrapPlugin(api, {
      director: {
        async preRequest() { return null },
        async postResponse() { return null }
      }
    })

    const original = [
      { role: 'system' as const, content: 'System.' },
      { role: 'user' as const, content: 'Hello.' }
    ]
    const result = await api.runBeforeRequest(original)

    expect(result).toHaveLength(2)
    expect(result[0]!.content).toBe('System.')
    expect(result[1]!.content).toBe('Hello.')
  })

  test('returns original messages when preRequest throws', async () => {
    const api = createMockRisuaiApi()

    await bootstrapPlugin(api, {
      director: {
        async preRequest() { throw new Error('LLM unavailable') },
        async postResponse() { return null }
      }
    })

    const original = [
      { role: 'system' as const, content: 'Rules.' },
      { role: 'user' as const, content: 'Continue.' }
    ]
    const result = await api.runBeforeRequest(original)

    expect(result).toHaveLength(2)
    expect(result[0]!.content).toBe('Rules.')
    expect(api.__logs.some((l) => l.includes('preRequest failed'))).toBe(true)
  })

  test('skips director when circuit breaker is open', async () => {
    const api = createMockRisuaiApi()
    const preRequest = vi.fn(async () => makePreResult())

    await bootstrapPlugin(api, {
      director: { preRequest, async postResponse() { return null } },
      circuitBreaker: {
        isOpen: () => true,
        recordSuccess: () => {},
        recordFailure: () => {}
      }
    })

    const result = await api.runBeforeRequest([
      { role: 'user', content: 'Go.' }
    ])

    expect(preRequest).not.toHaveBeenCalled()
    expect(result).toHaveLength(1)
  })

  test('skips director for non-matching request types', async () => {
    const api = createMockRisuaiApi()
    const preRequest = vi.fn(async () => makePreResult())

    await bootstrapPlugin(api, {
      director: { preRequest, async postResponse() { return null } },
      includeTypes: ['model']
    })

    const result = await api.runBeforeRequest(
      [{ role: 'user', content: 'Go.' }],
      'emotion'
    )

    expect(preRequest).not.toHaveBeenCalled()
    expect(result).toHaveLength(1)
  })

  test('afterRequest finalizes non-streaming response immediately', async () => {
    const api = createMockRisuaiApi()
    const postResponse = vi.fn(async () => makeUpdate())

    await bootstrapPlugin(api, {
      director: { async preRequest() { return makePreResult() }, postResponse }
    })

    await api.runBeforeRequest([
      { role: 'user', content: 'Go.' }
    ])
    await api.runAfterRequest('The actor responds.')

    expect(postResponse).toHaveBeenCalledTimes(1)
  })

  test('afterRequest does not double-finalize after streaming debounce', async () => {
    vi.useFakeTimers()
    const api = createMockRisuaiApi()
    const postResponse = vi.fn(async () => makeUpdate())

    await bootstrapPlugin(api, {
      director: { async preRequest() { return makePreResult() }, postResponse }
    })

    await api.runBeforeRequest([{ role: 'user', content: 'Go.' }])
    await api.runOutput('Partial text')

    await vi.advanceTimersByTimeAsync(401)
    expect(postResponse).toHaveBeenCalledTimes(1)

    await api.runAfterRequest('Final text')
    expect(postResponse).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  test('records circuit breaker failure when preRequest throws', async () => {
    const api = createMockRisuaiApi()
    const recordFailure = vi.fn()

    await bootstrapPlugin(api, {
      director: {
        async preRequest() { throw new Error('boom') },
        async postResponse() { return null }
      },
      circuitBreaker: {
        isOpen: () => false,
        recordSuccess: () => {},
        recordFailure
      }
    })

    await api.runBeforeRequest([{ role: 'user', content: 'Go.' }])
    expect(recordFailure).toHaveBeenCalledTimes(1)
  })

  test('cleanup cancels pending debounce on unload', async () => {
    vi.useFakeTimers()
    const api = createMockRisuaiApi()
    const postResponse = vi.fn(async () => makeUpdate())

    await bootstrapPlugin(api, {
      director: { async preRequest() { return makePreResult() }, postResponse }
    })

    await api.runBeforeRequest([{ role: 'user', content: 'Go.' }])
    await api.runOutput('Streaming...')

    await api.runUnload()
    await vi.advanceTimersByTimeAsync(500)

    expect(postResponse).toHaveBeenCalledTimes(0)
    vi.useRealTimers()
  })

  // ── Actor memory context plumbing ─────────────────────────────────

  test('carries actorMemoryContext in turn cache without injecting into messages', async () => {
    const api = createMockRisuaiApi()
    const { TurnCache } = await import('../src/memory/turnCache.js')
    const turnCache = new TurnCache()
    const capturedTurnId: string[] = []

    await bootstrapPlugin(api, {
      director: {
        async preRequest(input) {
          capturedTurnId.push(input.turnId)
          return makePreResult(undefined, 'Some actor long-memory context')
        },
        async postResponse() { return makeUpdate() },
      },
      turnCache,
    })

    const result = await api.runBeforeRequest([
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Continue.' }
    ])

    // Brief injection still works
    expect(result.some((m) => m.content.includes('<director-brief'))).toBe(true)

    // Actor memory context is NOT injected into messages
    expect(result.every((m) => !m.content.includes('Some actor long-memory context'))).toBe(true)

    // But it is stored in the turn cache
    const turn = turnCache.get(capturedTurnId[0]!)
    expect(turn).toBeDefined()
    expect(turn!.actorMemoryContext).toBe('Some actor long-memory context')
  })

  // ── Regression: onShutdown lifecycle wiring ────────────────────────

  test('onUnload calls onShutdown callback', async () => {
    const api = createMockRisuaiApi()
    const onShutdown = vi.fn(async () => {})

    await bootstrapPlugin(api, {
      director: {
        async preRequest() { return null },
        async postResponse() { return null },
      },
      onShutdown,
    })

    await api.runUnload()

    expect(onShutdown).toHaveBeenCalledTimes(1)
  })

  test('onUnload tolerates onShutdown throwing', async () => {
    const api = createMockRisuaiApi()
    const onShutdown = vi.fn(async () => {
      throw new Error('shutdown boom')
    })

    await bootstrapPlugin(api, {
      director: {
        async preRequest() { return null },
        async postResponse() { return null },
      },
      onShutdown,
    })

    // Should not throw even if onShutdown throws
    await expect(api.runUnload()).resolves.toBeUndefined()
    expect(api.__logs.some((l) => l.includes('shutdown'))).toBe(true)
  })

  // ── Diagnostics integration ─────────────────────────────────────────

  test('records diagnostics breadcrumbs on preRequest failure', async () => {
    const api = createMockRisuaiApi()
    const { DiagnosticsManager } = await import('../src/runtime/diagnostics.js')
    const diagnostics = new DiagnosticsManager(api.pluginStorage, 'test-scope')

    await bootstrapPlugin(api, {
      director: {
        async preRequest(): Promise<DirectorPreRequestResult | null> {
          throw new Error('model unavailable')
        },
        async postResponse(): Promise<MemoryUpdate | null> {
          return null
        }
      },
      diagnostics,
    })

    await api.runBeforeRequest([
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Continue.' }
    ])

    const snap = diagnostics.getSnapshot()
    expect(snap.lastErrorMessage).toBe('model unavailable')
    expect(snap.breadcrumbs.some((b) => b.label === 'error:preRequest')).toBe(true)
  })

  test('records diagnostics breadcrumbs on successful hook cycle', async () => {
    const api = createMockRisuaiApi()
    const { DiagnosticsManager } = await import('../src/runtime/diagnostics.js')
    const diagnostics = new DiagnosticsManager(api.pluginStorage, 'test-scope')

    await bootstrapPlugin(api, {
      director: {
        async preRequest(): Promise<DirectorPreRequestResult> {
          return makePreResult()
        },
        async postResponse(): Promise<MemoryUpdate | null> {
          return makeUpdate()
        }
      },
      diagnostics,
    })

    await api.runBeforeRequest([
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Continue.' }
    ])

    const snap = diagnostics.getSnapshot()
    expect(snap.lastHookKind).toBe('beforeRequest')
    expect(snap.breadcrumbs.some((b) => b.label === 'hook:beforeRequest')).toBe(true)
  })

  test('records shutdown diagnostics on plugin unload', async () => {
    const api = createMockRisuaiApi()
    const { DiagnosticsManager } = await import('../src/runtime/diagnostics.js')
    const diagnostics = new DiagnosticsManager(api.pluginStorage, 'test-scope')

    await bootstrapPlugin(api, {
      director: {
        async preRequest(): Promise<DirectorPreRequestResult | null> {
          return null
        },
        async postResponse(): Promise<MemoryUpdate | null> {
          return null
        }
      },
      diagnostics,
    })

    await api.runUnload()

    const snap = diagnostics.getSnapshot()
    expect(snap.lastHookKind).toBe('shutdown')
    expect(snap.breadcrumbs.some((b) => b.label === 'hook:shutdown')).toBe(true)
  })
})