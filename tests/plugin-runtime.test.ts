import { vi } from 'vitest'
import { bootstrapPlugin } from '../src/runtime/plugin.js'
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

describe('bootstrapPlugin', () => {
  test('registers hooks and settings UI', async () => {
    const api = createMockRisuaiApi()

    await bootstrapPlugin(api, {
      director: {
        async preRequest(): Promise<SceneBrief | null> {
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
        async preRequest(): Promise<SceneBrief> {
          return {
            confidence: 0.95,
            pacing: 'tight',
            beats: [{ goal: 'Escalate', reason: 'Pressure needed' }],
            continuityLocks: ['The ring is still hidden.'],
            ensembleWeights: { A: 1 },
            styleInheritance: { genre: 'mythic' },
            forbiddenMoves: ['Do not reveal the secret.'],
            memoryHints: ['ring']
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
        async preRequest(): Promise<SceneBrief> {
          return {
            confidence: 0.95,
            pacing: 'steady',
            beats: [{ goal: 'Escalate', reason: 'Pressure needed' }],
            continuityLocks: ['The ring is still hidden.'],
            ensembleWeights: { A: 1 },
            styleInheritance: { genre: 'mythic' },
            forbiddenMoves: ['Do not reveal the secret.'],
            memoryHints: ['ring']
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
    const preRequest = vi.fn(async () => makeBrief())

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
    const preRequest = vi.fn(async () => makeBrief())

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
      director: { async preRequest() { return makeBrief() }, postResponse }
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
      director: { async preRequest() { return makeBrief() }, postResponse }
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
      director: { async preRequest() { return makeBrief() }, postResponse }
    })

    await api.runBeforeRequest([{ role: 'user', content: 'Go.' }])
    await api.runOutput('Streaming...')

    await api.runUnload()
    await vi.advanceTimersByTimeAsync(500)

    expect(postResponse).toHaveBeenCalledTimes(0)
    vi.useRealTimers()
  })
})
