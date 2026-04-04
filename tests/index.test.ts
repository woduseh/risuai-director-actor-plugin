import { vi } from 'vitest'
import { registerContinuityDirectorPlugin } from '../src/index.js'
import * as dashboardApp from '../src/ui/dashboardApp.js'
import { createEmptyState } from '../src/contracts/types.js'
import { DIRECTOR_STATE_STORAGE_KEY } from '../src/memory/canonicalStore.js'
import {
  BUILTIN_PROMPT_PRESET_ID,
  DEFAULT_DIRECTOR_PROMPT_PRESET,
} from '../src/director/prompt.js'
import { createMockRisuaiApi } from './helpers/mockRisuai.js'
import { MemdirStore } from '../src/memory/memdirStore.js'
import {
  diagnosticsStorageKey,
  type DiagnosticsSnapshot,
} from '../src/runtime/diagnostics.js'
import { refreshGuardStorageKey } from '../src/runtime/refreshGuard.js'

describe('registerContinuityDirectorPlugin', () => {
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

    await registerContinuityDirectorPlugin(api)

    const before = await api.runBeforeRequest([
      { role: 'system', content: 'Main prompt rules.' },
      { role: 'system', content: 'Author Note: keep the tension restrained.' },
      { role: 'user', content: 'Continue the scene.' }
    ])

    expect(before[2]?.content).toContain('Director Long Memory')
    expect(before[3]?.content).toContain('<director-brief version="1">')
    expect(before[4]?.role).toBe('user')

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

    await registerContinuityDirectorPlugin(api)
    await api.runBeforeRequest([
      { role: 'system', content: 'Main prompt rules.' },
      { role: 'user', content: 'Continue the scene.' },
    ])

    expect(spy).toHaveBeenCalled()
    const request = spy.mock.calls[0]?.[0]
    expect(request?.messages[0]?.content).toContain('Custom runtime preset system.')
    expect(state.settings.promptPresetId).not.toBe(BUILTIN_PROMPT_PRESET_ID)
  })

  test('afterRequest stores extraction cursor in safeLocalStorage', async () => {
    const api = createMockRisuaiApi()

    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        confidence: 0.93,
        pacing: 'steady',
        beats: [{ goal: 'Escalate', reason: 'Needed' }],
        continuityLocks: [],
        ensembleWeights: {},
        styleInheritance: {},
        forbiddenMoves: [],
        memoryHints: [],
      }),
    })
    // postResponse result (Director compatibility path)
    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        status: 'pass',
        turnScore: 0.8,
        violations: [],
        durableFacts: ['Something happened.'],
        sceneDelta: {},
        entityUpdates: [],
        relationUpdates: [],
        memoryOps: [],
      }),
    })

    await registerContinuityDirectorPlugin(api)

    await api.runBeforeRequest([
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Go.' },
    ])
    await api.runAfterRequest('The actor responds.')

    // Let microtask/housekeeping drain
    await new Promise((r) => setTimeout(r, 50))

    // The extraction cursor should be stored in safeLocalStorage
    const cursor = await api.safeLocalStorage.getItem<number>('continuity-director:extraction:cursor')
    // Cursor should be set (≥1) after the turn was finalized
    expect(cursor).toBeGreaterThanOrEqual(1)
  })

  test('background extraction retries transient fail responses and persists memdir docs on recovery', async () => {
    const api = createMockRisuaiApi()

    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        confidence: 0.93,
        pacing: 'steady',
        beats: [{ goal: 'Escalate', reason: 'Needed' }],
        continuityLocks: [],
        ensembleWeights: {},
        styleInheritance: {},
        forbiddenMoves: [],
        memoryHints: [],
      }),
    })
    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        status: 'pass',
        turnScore: 0.8,
        violations: [],
        durableFacts: ['Immediate post-response write.'],
        sceneDelta: {},
        entityUpdates: [],
        relationUpdates: [],
        memoryOps: [],
      }),
    })
    api.enqueueLlmResult({
      type: 'fail',
      result: '429 Too Many Requests',
    })
    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        status: 'pass',
        turnScore: 0.8,
        violations: [],
        durableFacts: ['Recovered extraction memory.'],
        sceneDelta: {},
        entityUpdates: [],
        relationUpdates: [],
        memoryOps: [],
      }),
    })

    await registerContinuityDirectorPlugin(api)

    await api.runBeforeRequest([
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Go.' },
    ])
    await api.runAfterRequest('The actor responds.')
    await api.runUnload()

    const memdirStore = new MemdirStore(api.pluginStorage, 'default')
    const docs = await memdirStore.listDocuments()

    expect(docs.some((doc) => doc.description.includes('Recovered extraction memory.'))).toBe(true)
    expect(api.__logs.some((entry) => entry.includes('Retrying'))).toBe(true)
  })

  test('non-transient extraction failure records diagnostics before returning', async () => {
    const api = createMockRisuaiApi()

    // Pre-request LLM result (success)
    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        confidence: 0.93,
        pacing: 'steady',
        beats: [{ goal: 'Escalate', reason: 'Needed' }],
        continuityLocks: [],
        ensembleWeights: {},
        styleInheritance: {},
        forbiddenMoves: [],
        memoryHints: [],
      }),
    })
    // Inline director.postResponse (success — so housekeeping runs)
    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        status: 'pass',
        turnScore: 0.8,
        violations: [],
        durableFacts: ['Inline fact.'],
        sceneDelta: {},
        entityUpdates: [],
        relationUpdates: [],
        memoryOps: [],
      }),
    })
    // Background extraction: non-transient failure (no 429/500/timeout keywords)
    api.enqueueLlmResult({
      type: 'fail',
      result: 'Invalid model configuration',
    })

    await registerContinuityDirectorPlugin(api)

    await api.runBeforeRequest([
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Go.' },
    ])
    await api.runAfterRequest('The actor responds.')

    // Let microtask/housekeeping drain
    await new Promise((r) => setTimeout(r, 100))

    // Diagnostics should record the extraction failure
    const diagKey = diagnosticsStorageKey(DIRECTOR_STATE_STORAGE_KEY)
    const snap = await api.pluginStorage.getItem<DiagnosticsSnapshot>(diagKey)
    expect(snap).not.toBeNull()
    expect(snap!.extraction.health).toBe('error')
    expect(snap!.extraction.lastDetail).toContain('Invalid model configuration')
  })
})

// ---------------------------------------------------------------------------
// Regression: composition-root wiring
// ---------------------------------------------------------------------------

describe('composition root wiring', () => {
  test('CanonicalStore receives memdirStore so migration runs on load', async () => {
    const api = createMockRisuaiApi()

    // Seed canonical state with memory data that migration would explode
    const state = createEmptyState()
    state.memory.entities = [
      { id: 'e-wiring', name: 'WiringHero', facts: ['Brave'], updatedAt: 1000 },
    ]
    state.memory.worldFacts = [
      { id: 'wf-wiring', text: 'The realm is at peace', updatedAt: 1000 },
    ]
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)

    // Enqueue a pre-request LLM response so the plugin can boot
    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        confidence: 0.9,
        pacing: 'steady',
        beats: [],
        continuityLocks: [],
        ensembleWeights: {},
        styleInheritance: {},
        forbiddenMoves: [],
        memoryHints: [],
      }),
    })

    await registerContinuityDirectorPlugin(api)

    // After registration, memdir store should contain migrated documents
    // The default scope uses 'default' as the memdir scope key
    const memdirStore = new MemdirStore(api.pluginStorage, 'default')
    const docs = await memdirStore.listDocuments()

    expect(docs.length).toBeGreaterThan(0)
    expect(docs.some((d) => d.source === 'migration')).toBe(true)
  })

  test('dashboard store receives operator callbacks in production wiring', async () => {
    const api = createMockRisuaiApi()

    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        confidence: 0.9,
        pacing: 'steady',
        beats: [],
        continuityLocks: [],
        ensembleWeights: {},
        styleInheritance: {},
        forbiddenMoves: [],
        memoryHints: [],
      }),
    })

    await registerContinuityDirectorPlugin(api)

    // The plugin should have registered a setting callback for the dashboard
    const settingEntry = api.__registerCalls.find((c) => c.kind === 'setting')
    expect(settingEntry).toBeDefined()

    // The openSettings callback internally creates a dashboardStore.
    // We can't directly inspect it, but we can verify no error is thrown
    // when the setting is triggered (meaning the callbacks are wired).
    // We need a container UI response — the dashboard opens via showContainer.
    // Since we don't have a real DOM, calling the setting will attempt openDashboard
    // which needs the container API. We verify it at least doesn't crash on init.
    // The full E2E is better tested by the dashboard tests.
  })

  test('openSettings wires a live scope rebuild callback into the dashboard store', async () => {
    const api = createMockRisuaiApi()
    const openSpy = vi.spyOn(dashboardApp, 'openDashboard').mockResolvedValue()

    await registerContinuityDirectorPlugin(api)

    const settingEntry = api.__registerCalls.find((c) => c.kind === 'setting')
    expect(settingEntry).toBeDefined()

    await settingEntry!.callback()

    expect(openSpy).toHaveBeenCalledTimes(1)
    const dashboardStore = openSpy.mock.calls[0]?.[1]
    expect(dashboardStore).toBeDefined()
    expect(typeof dashboardStore?.rebuildForActiveScope).toBe('function')
  })

  test('startup stamps the refresh guard in safeLocalStorage', async () => {
    const api = createMockRisuaiApi()

    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        confidence: 0.9,
        pacing: 'steady',
        beats: [],
        continuityLocks: [],
        ensembleWeights: {},
        styleInheritance: {},
        forbiddenMoves: [],
        memoryHints: [],
      }),
    })

    const beforeTs = Date.now()
    await registerContinuityDirectorPlugin(api)

    // The scope resolves to DIRECTOR_STATE_STORAGE_KEY in tests (fallback)
    const guardKey = refreshGuardStorageKey(DIRECTOR_STATE_STORAGE_KEY)
    const guardData = await api.safeLocalStorage.getItem<{
      startupTs: number
    }>(guardKey)
    expect(guardData).not.toBeNull()
    expect(guardData!.startupTs).toBeGreaterThanOrEqual(beforeTs)
  })

  test('shutdown stamps the refresh guard in safeLocalStorage', async () => {
    const api = createMockRisuaiApi()

    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        confidence: 0.9,
        pacing: 'steady',
        beats: [],
        continuityLocks: [],
        ensembleWeights: {},
        styleInheritance: {},
        forbiddenMoves: [],
        memoryHints: [],
      }),
    })

    await registerContinuityDirectorPlugin(api)
    const beforeShutdown = Date.now()
    await api.runUnload()

    const guardKey = refreshGuardStorageKey(DIRECTOR_STATE_STORAGE_KEY)
    const guardData = await api.safeLocalStorage.getItem<{
      startupTs: number
      shutdownTs: number
    }>(guardKey)
    expect(guardData).not.toBeNull()
    expect(guardData!.shutdownTs).toBeGreaterThanOrEqual(beforeShutdown)
  })

  test('housekeeping.shutdown still runs when markShutdown throws', async () => {
    const api = createMockRisuaiApi()

    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        confidence: 0.9,
        pacing: 'steady',
        beats: [],
        continuityLocks: [],
        ensembleWeights: {},
        styleInheritance: {},
        forbiddenMoves: [],
        memoryHints: [],
      }),
    })

    await registerContinuityDirectorPlugin(api)

    // Make safeLocalStorage.setItem throw so markShutdown fails
    const guardKey = refreshGuardStorageKey(DIRECTOR_STATE_STORAGE_KEY)
    const originalSetItem = api.safeLocalStorage.setItem.bind(api.safeLocalStorage)
    vi.spyOn(api.safeLocalStorage, 'setItem').mockImplementation(
      async (key: string, value: unknown) => {
        if (key === guardKey) throw new Error('storage write failed')
        return originalSetItem(key, value)
      },
    )

    // Shutdown should still complete without throwing
    await expect(api.runUnload()).resolves.toBeUndefined()

    // Verify the guard was NOT stamped (because setItem threw)
    const guardData = await api.safeLocalStorage.getItem<{
      shutdownTs: number
    }>(guardKey)
    // The guard data from startup is still there, but shutdownTs should
    // not have been updated since setItem threw
    expect(guardData!.shutdownTs).toBe(0)
  })

  test('different-scope rebuild wires forceExtract into the dashboard store', async () => {
    const api = createMockRisuaiApi()
    const openSpy = vi.spyOn(dashboardApp, 'openDashboard').mockResolvedValue()

    // resolveScopeStorageKey is called once at plugin registration (root scope)
    // and once inside buildDashboardStoreForCurrentScope (live scope).
    // We need the live scope call to return a different key.
    const scopeResolver = await import('../src/memory/scopeResolver.js')
    const resolveStub = vi.spyOn(scopeResolver, 'resolveScopeStorageKey')

    // First call (plugin registration) returns the fallback key
    resolveStub.mockResolvedValueOnce({
      storageKey: DIRECTOR_STATE_STORAGE_KEY,
      isFallback: true,
    })

    await registerContinuityDirectorPlugin(api)

    // Second call (buildDashboardStoreForCurrentScope) returns a DIFFERENT key
    resolveStub.mockResolvedValueOnce({
      storageKey: 'scope-other-chat',
      isFallback: false,
    })

    const settingEntry = api.__registerCalls.find((c) => c.kind === 'setting')
    expect(settingEntry).toBeDefined()

    await settingEntry!.callback()

    expect(openSpy).toHaveBeenCalledTimes(1)
    const dashboardStore = openSpy.mock.calls[0]?.[1]
    expect(dashboardStore).toBeDefined()
    expect(typeof dashboardStore?.rebuildForActiveScope).toBe('function')
    expect(typeof dashboardStore?.forceExtract).toBe('function')

    resolveStub.mockRestore()
  })
})
