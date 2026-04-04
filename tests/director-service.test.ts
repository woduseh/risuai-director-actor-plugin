import { describe, test, expect, vi, beforeAll } from 'vitest'
import { createMockRisuaiApi } from './helpers/mockRisuai.js'
import {
  DEFAULT_DIRECTOR_PROMPT_PRESET,
  buildPreRequestPrompt,
  buildPostResponsePrompt,
} from '../src/director/prompt.js'
import type { DirectorContext, PostReviewContext } from '../src/director/prompt.js'
import { createDirectorService } from '../src/director/service.js'
import type { PreRequestResult, PostResponseResult } from '../src/director/service.js'
import {
  DEFAULT_DIRECTOR_SETTINGS,
  createEmptyState,
  type DirectorSettings,
  type SceneBrief,
  type CanonicalMemory,
  type DirectorState,
} from '../src/contracts/types.js'
import {
  GITHUB_TOKEN_EXCHANGE_URL,
} from '../src/provider/copilotClient.js'
import { createVertexServiceAccountJson } from './helpers/vertexTestUtils.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_BRIEF: SceneBrief = {
  confidence: 0.85,
  pacing: 'steady',
  beats: [{ goal: 'introduce tension', reason: 'arc needs escalation' }],
  continuityLocks: ['Character A has the key'],
  ensembleWeights: { 'Character A': 1 },
  styleInheritance: { genre: 'fantasy' },
  forbiddenMoves: ['Do not kill Character A'],
  memoryHints: ['key', 'door'],
}

const VALID_BRIEF_JSON = JSON.stringify(VALID_BRIEF)

const VALID_UPDATE_JSON = JSON.stringify({
  status: 'pass',
  turnScore: 0.78,
  violations: [],
  durableFacts: ['Character A opened the door'],
  sceneDelta: { scenePhase: 'turn', activeCharacters: ['A'] },
  entityUpdates: [],
  relationUpdates: [],
  memoryOps: [{ op: 'insert', target: 'summaries', payload: { text: 'A opened the door' } }],
})

function makeDirectorContext(overrides?: Partial<DirectorContext>): DirectorContext {
  const state = createEmptyState()
  return {
    messages: [
      { role: 'system', content: 'You are a character in a story.' },
      { role: 'user', content: 'Tell me about the ancient key.' },
    ],
    directorState: state.director,
    memory: state.memory,
    assertiveness: 'standard',
    briefTokenCap: 320,
    ...overrides,
  }
}

function makePostReviewContext(overrides?: Partial<PostReviewContext>): PostReviewContext {
  const state = createEmptyState()
  return {
    responseText: 'Character A picked up the ancient key and turned toward the door.',
    brief: VALID_BRIEF,
    messages: [
      { role: 'system', content: 'You are a character in a story.' },
      { role: 'user', content: 'Tell me about the ancient key.' },
      { role: 'assistant', content: 'Character A picked up the ancient key and turned toward the door.' },
    ],
    directorState: state.director,
    memory: state.memory,
    assertiveness: 'standard',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Prompt builder tests
// ---------------------------------------------------------------------------

describe('buildPreRequestPrompt', () => {
  test('returns messages with a system role first', () => {
    const msgs = buildPreRequestPrompt(makeDirectorContext())
    expect(msgs.length).toBeGreaterThanOrEqual(2)
    expect(msgs[0]!.role).toBe('system')
  })

  test('system prompt mentions JSON output requirement', () => {
    const msgs = buildPreRequestPrompt(makeDirectorContext())
    const system = msgs[0]!.content
    expect(system).toContain('JSON')
    expect(system).toContain('confidence')
    expect(system).toContain('beats')
  })

  test('user message includes conversation context', () => {
    const msgs = buildPreRequestPrompt(makeDirectorContext())
    const userMsg = msgs.find(m => m.role === 'user')
    expect(userMsg).toBeDefined()
    expect(userMsg!.content).toContain('ancient key')
  })

  test('user message includes scene phase from director state', () => {
    const ctx = makeDirectorContext()
    ctx.directorState.scenePhase = 'pressure'
    const msgs = buildPreRequestPrompt(ctx)
    const userMsg = msgs.find(m => m.role === 'user')!
    expect(userMsg.content).toContain('pressure')
  })

  test('system prompt includes assertiveness instruction', () => {
    const light = buildPreRequestPrompt(makeDirectorContext({ assertiveness: 'light' }))
    const firm = buildPreRequestPrompt(makeDirectorContext({ assertiveness: 'firm' }))
    expect(light[0]!.content).not.toBe(firm[0]!.content)
  })

  test('includes briefTokenCap guidance in prompt', () => {
    const msgs = buildPreRequestPrompt(makeDirectorContext({ briefTokenCap: 200 }))
    const combined = msgs.map(m => m.content).join('\n')
    expect(combined).toContain('200')
  })

  test('includes memory summaries when available', () => {
    const ctx = makeDirectorContext()
    ctx.memory.summaries = [
      { id: 's1', text: 'The kingdom fell into darkness.', recencyWeight: 1, updatedAt: Date.now() },
    ]
    const msgs = buildPreRequestPrompt(ctx)
    const combined = msgs.map(m => m.content).join('\n')
    expect(combined).toContain('kingdom fell into darkness')
  })
})

describe('buildPostResponsePrompt', () => {
  test('returns messages with a system role first', () => {
    const msgs = buildPostResponsePrompt(makePostReviewContext())
    expect(msgs.length).toBeGreaterThanOrEqual(2)
    expect(msgs[0]!.role).toBe('system')
  })

  test('system prompt mentions MemoryUpdate schema fields', () => {
    const msgs = buildPostResponsePrompt(makePostReviewContext())
    const system = msgs[0]!.content
    expect(system).toContain('status')
    expect(system).toContain('turnScore')
    expect(system).toContain('memoryOps')
  })

  test('user message includes the AI response text', () => {
    const msgs = buildPostResponsePrompt(makePostReviewContext())
    const userMsg = msgs.find(m => m.role === 'user')!
    expect(userMsg.content).toContain('picked up the ancient key')
  })

  test('user message includes brief context', () => {
    const msgs = buildPostResponsePrompt(makePostReviewContext())
    const userMsg = msgs.find(m => m.role === 'user')!
    expect(userMsg.content).toContain('introduce tension')
  })
})

// ---------------------------------------------------------------------------
// DirectorService tests
// ---------------------------------------------------------------------------

describe('DirectorService', () => {
  const settings: DirectorSettings = { ...DEFAULT_DIRECTOR_SETTINGS }
  let vertexJsonKey = ''

  beforeAll(async () => {
    vertexJsonKey = await createVertexServiceAccountJson()
  })

  describe('preRequest', () => {
    test('returns ok:true with parsed SceneBrief on LLM success', async () => {
      const api = createMockRisuaiApi()
      api.enqueueLlmResult({ type: 'success', result: VALID_BRIEF_JSON })
      const svc = createDirectorService(api, settings)

      const result = await svc.preRequest(makeDirectorContext())

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.brief.confidence).toBe(0.85)
      expect(result.brief.pacing).toBe('steady')
      expect(result.raw).toBe(VALID_BRIEF_JSON)
    })

    test('returns ok:false when LLM returns type "fail"', async () => {
      const api = createMockRisuaiApi()
      api.enqueueLlmResult({ type: 'fail', result: 'model refused' })
      const svc = createDirectorService(api, settings)

      const result = await svc.preRequest(makeDirectorContext())

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain('model refused')
    })

    test('returns ok:false when LLM returns unparseable JSON', async () => {
      const api = createMockRisuaiApi()
      api.enqueueLlmResult({ type: 'success', result: 'not valid json {{{' })
      const svc = createDirectorService(api, settings)

      const result = await svc.preRequest(makeDirectorContext())

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toBeTruthy()
      expect(result.raw).toBe('not valid json {{{')
    })

    test('returns ok:false when JSON is valid but missing required fields', async () => {
      const api = createMockRisuaiApi()
      api.enqueueLlmResult({ type: 'success', result: '{"confidence": 0.5}' })
      const svc = createDirectorService(api, settings)

      const result = await svc.preRequest(makeDirectorContext())

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain('SceneBrief')
    })

    test('passes configured model and mode to runLLMModel', async () => {
      const api = createMockRisuaiApi()
      api.enqueueLlmResult({ type: 'success', result: VALID_BRIEF_JSON })
      const spy = vi.spyOn(api, 'runLLMModel')
      const customSettings: DirectorSettings = {
        ...settings,
        directorModel: 'claude-sonnet-4-20250514',
        directorMode: 'model',
      }
      const svc = createDirectorService(api, customSettings)

      await svc.preRequest(makeDirectorContext())

      expect(spy).toHaveBeenCalledOnce()
      const input = spy.mock.calls[0]![0]
      expect(input.staticModel).toBe('claude-sonnet-4-20250514')
      expect(input.mode).toBe('model')
    })

    test('handles markdown-fenced JSON from LLM', async () => {
      const api = createMockRisuaiApi()
      api.enqueueLlmResult({ type: 'success', result: '```json\n' + VALID_BRIEF_JSON + '\n```' })
      const svc = createDirectorService(api, settings)

      const result = await svc.preRequest(makeDirectorContext())

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.brief.confidence).toBe(0.85)
    })

    test('passes custom prompt preset content through to the LLM call', async () => {
      const api = createMockRisuaiApi()
      api.enqueueLlmResult({ type: 'success', result: VALID_BRIEF_JSON })
      const spy = vi.spyOn(api, 'runLLMModel')
      const svc = createDirectorService(api, settings)

      await svc.preRequest(
        makeDirectorContext({
          promptPreset: {
            ...DEFAULT_DIRECTOR_PROMPT_PRESET,
            preRequestSystemTemplate: 'Preset override.\n{{assertivenessDirective}}',
          },
        }),
      )

      expect(spy).toHaveBeenCalledOnce()
      const llmMessages = spy.mock.calls[0]![0].messages
      expect(llmMessages[0]?.content).toContain('Preset override.')
    })
  })

  describe('postResponse', () => {
    test('returns ok:true with parsed MemoryUpdate on LLM success', async () => {
      const api = createMockRisuaiApi()
      api.enqueueLlmResult({ type: 'success', result: VALID_UPDATE_JSON })
      const svc = createDirectorService(api, settings)

      const result = await svc.postResponse(makePostReviewContext())

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.update.status).toBe('pass')
      expect(result.update.turnScore).toBe(0.78)
      expect(result.raw).toBe(VALID_UPDATE_JSON)
    })

    test('returns ok:false when LLM returns type "fail"', async () => {
      const api = createMockRisuaiApi()
      api.enqueueLlmResult({ type: 'fail', result: 'rate limited' })
      const svc = createDirectorService(api, settings)

      const result = await svc.postResponse(makePostReviewContext())

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain('rate limited')
    })

    test('returns ok:false when LLM returns unparseable JSON', async () => {
      const api = createMockRisuaiApi()
      api.enqueueLlmResult({ type: 'success', result: '<html>error</html>' })
      const svc = createDirectorService(api, settings)

      const result = await svc.postResponse(makePostReviewContext())

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.raw).toBe('<html>error</html>')
    })

    test('returns ok:false when JSON is valid but missing required fields', async () => {
      const api = createMockRisuaiApi()
      api.enqueueLlmResult({ type: 'success', result: '{"status":"pass"}' })
      const svc = createDirectorService(api, settings)

      const result = await svc.postResponse(makePostReviewContext())

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain('MemoryUpdate')
    })

    test('handles markdown-fenced JSON from LLM', async () => {
      const api = createMockRisuaiApi()
      api.enqueueLlmResult({ type: 'success', result: '```json\n' + VALID_UPDATE_JSON + '\n```' })
      const svc = createDirectorService(api, settings)

      const result = await svc.postResponse(makePostReviewContext())

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.update.turnScore).toBe(0.78)
    })
  })

  // -----------------------------------------------------------------------
  // Copilot provider integration
  // -----------------------------------------------------------------------

  describe('Copilot provider', () => {
    const COPILOT_EXCHANGE_RESPONSE = {
      token: 'tid=copilot-test-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }

    function copilotSettings(
      overrides?: Partial<DirectorSettings>,
    ): DirectorSettings {
      return {
        ...DEFAULT_DIRECTOR_SETTINGS,
        directorProvider: 'copilot',
        directorCopilotToken: 'ghp_test123',
        directorModel: 'gpt-4.1',
        ...overrides,
      }
    }

    test('uses nativeFetch for Copilot instead of runLLMModel', async () => {
      const api = createMockRisuaiApi()
      api.enqueueNativeFetchJson(COPILOT_EXCHANGE_RESPONSE)
      api.enqueueNativeFetchJson({
        choices: [{ message: { content: VALID_BRIEF_JSON } }],
      })

      const spy = vi.spyOn(api, 'runLLMModel')
      const svc = createDirectorService(api, copilotSettings())
      const result = await svc.preRequest(makeDirectorContext())

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.brief.confidence).toBe(0.85)
      expect(spy).not.toHaveBeenCalled()
    })

    test('reuses exchanged Copilot tokens across service instances', async () => {
      const api = createMockRisuaiApi()
      api.enqueueNativeFetchJson(COPILOT_EXCHANGE_RESPONSE)
      api.enqueueNativeFetchJson({
        choices: [{ message: { content: VALID_BRIEF_JSON } }],
      })
      api.enqueueNativeFetchJson({
        choices: [{ message: { content: VALID_BRIEF_JSON } }],
      })

      const nativeFetchSpy = vi.spyOn(api, 'nativeFetch')
      const firstService = createDirectorService(api, copilotSettings())
      const secondService = createDirectorService(api, copilotSettings())

      const firstResult = await firstService.preRequest(makeDirectorContext())
      const secondResult = await secondService.preRequest(makeDirectorContext())

      expect(firstResult.ok).toBe(true)
      expect(secondResult.ok).toBe(true)
      expect(nativeFetchSpy).toHaveBeenCalledTimes(3)
      expect(nativeFetchSpy.mock.calls[0]![0]).toBe(GITHUB_TOKEN_EXCHANGE_URL)
      expect(String(nativeFetchSpy.mock.calls[1]![0])).toContain('/chat/completions')
      expect(String(nativeFetchSpy.mock.calls[2]![0])).toContain('/chat/completions')
    })

    test('preserves host runLLMModel path for non-Copilot providers', async () => {
      const api = createMockRisuaiApi()
      api.enqueueLlmResult({ type: 'success', result: VALID_BRIEF_JSON })

      const spy = vi.spyOn(api, 'runLLMModel')
      const svc = createDirectorService(api, {
        ...DEFAULT_DIRECTOR_SETTINGS,
        directorProvider: 'openai',
      })
      await svc.preRequest(makeDirectorContext())

      expect(spy).toHaveBeenCalledOnce()
    })

    test('returns ok:false when Copilot inference fails', async () => {
      const api = createMockRisuaiApi()
      api.enqueueNativeFetchJson(COPILOT_EXCHANGE_RESPONSE)
      api.enqueueNativeFetchJson({ error: 'Rate limited' }, { status: 429 })

      const svc = createDirectorService(api, copilotSettings())
      const result = await svc.preRequest(makeDirectorContext())

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain('LLM call failed')
    })

    test('Copilot postResponse works with responses API for gpt-5.4', async () => {
      const api = createMockRisuaiApi()
      api.enqueueNativeFetchJson(COPILOT_EXCHANGE_RESPONSE)
      api.enqueueNativeFetchJson({
        output: [
          {
            type: 'message',
            content: [
              { type: 'output_text', text: VALID_UPDATE_JSON },
            ],
          },
        ],
      })

      const svc = createDirectorService(
        api,
        copilotSettings({ directorModel: 'gpt-5.4' }),
      )
      const result = await svc.postResponse(makePostReviewContext())

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.update.status).toBe('pass')
      expect(result.update.turnScore).toBe(0.78)
    })

    test('Copilot preRequest works with Claude via /v1/messages', async () => {
      const api = createMockRisuaiApi()
      api.enqueueNativeFetchJson(COPILOT_EXCHANGE_RESPONSE)
      api.enqueueNativeFetchJson({
        content: [{ type: 'text', text: VALID_BRIEF_JSON }],
      })

      const svc = createDirectorService(
        api,
        copilotSettings({ directorModel: 'claude-sonnet-4-6' }),
      )
      const result = await svc.preRequest(makeDirectorContext())

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.brief.confidence).toBe(0.85)
    })

    test('handles markdown-fenced JSON from Copilot inference', async () => {
      const api = createMockRisuaiApi()
      api.enqueueNativeFetchJson(COPILOT_EXCHANGE_RESPONSE)
      api.enqueueNativeFetchJson({
        choices: [
          { message: { content: '```json\n' + VALID_BRIEF_JSON + '\n```' } },
        ],
      })

      const svc = createDirectorService(api, copilotSettings())
      const result = await svc.preRequest(makeDirectorContext())

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.brief.confidence).toBe(0.85)
    })
  })

  describe('Vertex provider', () => {
    function vertexSettings(
      overrides?: Partial<DirectorSettings>,
    ): DirectorSettings {
      return {
        ...DEFAULT_DIRECTOR_SETTINGS,
        directorProvider: 'vertex',
        directorVertexJsonKey: vertexJsonKey,
        directorModel: 'gemini-2.5-pro',
        ...overrides,
      }
    }

    test('uses nativeFetch for Vertex instead of runLLMModel', async () => {
      const api = createMockRisuaiApi()
      api.enqueueNativeFetchJson({ access_token: 'ya29.vertex-token', expires_in: 3600 })
      api.enqueueNativeFetchJson({
        candidates: [
          {
            content: {
              parts: [{ text: VALID_BRIEF_JSON }],
            },
          },
        ],
      })

      const spy = vi.spyOn(api, 'runLLMModel')
      const svc = createDirectorService(api, vertexSettings())
      const result = await svc.preRequest(makeDirectorContext())

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.brief.confidence).toBe(0.85)
      expect(spy).not.toHaveBeenCalled()
    })

    test('returns ok:false for unsupported Vertex model families', async () => {
      const api = createMockRisuaiApi()
      const svc = createDirectorService(
        api,
        vertexSettings({ directorModel: 'claude-sonnet-4-6' }),
      )
      const result = await svc.preRequest(makeDirectorContext())

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toMatch(/gemini/i)
    })

    test('returns ok:false when Vertex generateContent fails', async () => {
      const api = createMockRisuaiApi()
      api.enqueueNativeFetchJson({ access_token: 'ya29.test', expires_in: 3600 })
      api.enqueueNativeFetchJson({ error: 'Quota exceeded' }, { status: 429 })

      const svc = createDirectorService(api, vertexSettings())
      const result = await svc.preRequest(makeDirectorContext())

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain('LLM call failed')
    })

    test('Vertex postResponse parses MemoryUpdate from Gemini response', async () => {
      const api = createMockRisuaiApi()
      api.enqueueNativeFetchJson({ access_token: 'ya29.test', expires_in: 3600 })
      api.enqueueNativeFetchJson({
        candidates: [{ content: { parts: [{ text: VALID_UPDATE_JSON }] } }],
      })

      const svc = createDirectorService(api, vertexSettings())
      const result = await svc.postResponse(makePostReviewContext())

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.update.status).toBe('pass')
    })

    test('non-Vertex providers still use host runLLMModel path', async () => {
      const api = createMockRisuaiApi()
      api.enqueueLlmResult({ type: 'success', result: VALID_BRIEF_JSON })

      const spy = vi.spyOn(api, 'runLLMModel')
      const svc = createDirectorService(api, {
        ...DEFAULT_DIRECTOR_SETTINGS,
        directorProvider: 'google',
      })
      await svc.preRequest(makeDirectorContext())

      expect(spy).toHaveBeenCalledOnce()
    })
  })
})
