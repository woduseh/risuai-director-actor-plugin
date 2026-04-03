import { vi } from 'vitest'
import { registerDirectorActorPlugin } from '../src/index.js'
import { createEmptyState } from '../src/contracts/types.js'
import { DIRECTOR_STATE_STORAGE_KEY } from '../src/memory/canonicalStore.js'
import {
  BUILTIN_PROMPT_PRESET_ID,
  DEFAULT_DIRECTOR_PROMPT_PRESET,
} from '../src/director/prompt.js'
import { createMockRisuaiApi } from './helpers/mockRisuai.js'

describe('registerDirectorActorPlugin', () => {
  test('wires the live plugin, injects via author-note routing, and persists memory updates', async () => {
    const api = createMockRisuaiApi()

    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        confidence: 0.93,
        pacing: 'steady',
        beats: [{ goal: 'Escalate the choice', reason: 'The arc needs pressure' }],
        continuityLocks: ['A still hides the key.'],
        ensembleWeights: { A: 1 },
        styleInheritance: { genre: 'mythic', register: 'literary' },
        forbiddenMoves: ['Do not reveal the king yet.'],
        memoryHints: ['key']
      })
    })
    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        status: 'pass',
        turnScore: 0.82,
        violations: [],
        durableFacts: ['A left with the hidden key.'],
        sceneDelta: { scenePhase: 'aftermath', activeCharacters: ['A'] },
        entityUpdates: [],
        relationUpdates: [],
        memoryOps: [
          {
            op: 'insert',
            target: 'summaries',
            payload: { text: 'A left with the hidden key.' }
          }
        ]
      })
    })

    await registerDirectorActorPlugin(api)

    const before = await api.runBeforeRequest([
      { role: 'system', content: 'Main prompt rules.' },
      { role: 'system', content: 'Author Note: keep the tension restrained.' },
      { role: 'user', content: 'Continue the scene.' }
    ])

    expect(before[2]?.content).toContain('<director-brief version="1">')
    expect(before[3]?.role).toBe('user')

    await api.runAfterRequest('A leaves with the hidden key.')

    const stored = await api.pluginStorage.getItem(DIRECTOR_STATE_STORAGE_KEY)
    expect(stored).not.toBeNull()

    const state = stored as {
      metrics: { totalDirectorCalls: number }
      memory: { summaries: Array<{ text: string }> }
      director: { scenePhase: string }
    }

    expect(state.metrics.totalDirectorCalls).toBe(1)
    expect(state.memory.summaries.some((entry) => entry.text.includes('hidden key'))).toBe(true)
    expect(state.director.scenePhase).toBe('aftermath')
  })

  test('uses the selected stored prompt preset for the live pre-request call', async () => {
    const api = createMockRisuaiApi()
    const state = createEmptyState()
    state.settings.promptPresetId = 'custom-runtime'
    state.settings.promptPresets = {
      'custom-runtime': {
        id: 'custom-runtime',
        name: 'Custom Runtime',
        createdAt: 1,
        updatedAt: 1,
        preset: {
          ...DEFAULT_DIRECTOR_PROMPT_PRESET,
          preRequestSystemTemplate:
            'Custom runtime preset system.\nSchema:\n{{sceneBriefSchema}}',
        },
      },
    }

    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        confidence: 0.93,
        pacing: 'steady',
        beats: [{ goal: 'Escalate the choice', reason: 'The arc needs pressure' }],
        continuityLocks: ['A still hides the key.'],
        ensembleWeights: { A: 1 },
        styleInheritance: { genre: 'mythic', register: 'literary' },
        forbiddenMoves: ['Do not reveal the king yet.'],
        memoryHints: ['key'],
      }),
    })

    const spy = vi.spyOn(api, 'runLLMModel')

    await registerDirectorActorPlugin(api)
    await api.runBeforeRequest([
      { role: 'system', content: 'Main prompt rules.' },
      { role: 'user', content: 'Continue the scene.' },
    ])

    expect(spy).toHaveBeenCalled()
    const request = spy.mock.calls[0]?.[0]
    expect(request?.messages[0]?.content).toContain('Custom runtime preset system.')
    expect(state.settings.promptPresetId).not.toBe(BUILTIN_PROMPT_PRESET_ID)
  })
})
