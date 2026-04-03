import { createEmptyState, DEFAULT_DIRECTOR_SETTINGS } from '../src/contracts/types.js'
import { BUILTIN_PROMPT_PRESET_ID } from '../src/director/prompt.js'
import {
  createDefaultProfileManifest,
  createDashboardDraft,
  createProfileExportPayload,
  mergeDashboardSettingsIntoPluginState,
  normalizePersistedSettings,
  createDefaultMemoryOpsStatus,
  computeDocumentCounts,
  computeNotebookFreshness,
} from '../src/ui/dashboardState.js'

describe('dashboardState', () => {
  test('normalizes missing persisted settings to safe defaults', () => {
    const settings = normalizePersistedSettings({})

    expect(settings.enabled).toBe(DEFAULT_DIRECTOR_SETTINGS.enabled)
    expect(settings.directorProvider).toBe('openai')
    expect(settings.directorBaseUrl).toBe('https://api.openai.com/v1')
    expect(settings.directorApiKey).toBe('')
  })

  test('normalizes embedding settings to safe defaults', () => {
    const settings = normalizePersistedSettings({}) as unknown as Record<string, unknown>

    expect(settings.embeddingProvider).toBe('openai')
    expect(settings.embeddingBaseUrl).toBe('https://api.openai.com/v1')
    expect(settings.embeddingApiKey).toBe('')
    expect(settings.embeddingModel).toBe('text-embedding-3-small')
    expect(settings.embeddingDimensions).toBe(1536)
  })

  test('normalizes prompt preset settings to safe defaults', () => {
    const settings = normalizePersistedSettings({}) as unknown as Record<string, unknown>

    expect(settings.promptPresetId).toBe(BUILTIN_PROMPT_PRESET_ID)
    expect(settings.promptPresets).toEqual({})
  })

  test('creates a draft wrapper with dirty state disabled by default', () => {
    const draft = createDashboardDraft(normalizePersistedSettings({}))

    expect(draft.isDirty).toBe(false)
    expect(draft.settings.directorModel).toBe(DEFAULT_DIRECTOR_SETTINGS.directorModel)
  })

  test('creates built-in profiles and a valid active profile id', () => {
    const manifest = createDefaultProfileManifest()

    expect(manifest.profiles.length).toBeGreaterThanOrEqual(3)
    expect(manifest.activeProfileId.length).toBeGreaterThan(0)
  })

  test('exports a typed profile payload envelope', () => {
    const payload = createProfileExportPayload({
      id: 'profile-1',
      name: 'Balanced',
      createdAt: 1,
      updatedAt: 1,
      basedOn: null,
      overrides: { assertiveness: 'standard' }
    })

    expect(payload.schema).toBe('director-actor-dashboard-profile')
    expect(payload.version).toBe(1)
    expect(payload.profile.name).toBe('Balanced')
  })

  test('merges saved dashboard settings back into canonical plugin state', () => {
    const state = createEmptyState()
    const next = mergeDashboardSettingsIntoPluginState(
      state,
      normalizePersistedSettings({
        enabled: false,
        directorProvider: 'anthropic',
        directorBaseUrl: 'https://api.anthropic.com/v1'
      })
    )

    expect(next.settings.enabled).toBe(false)
    expect(next.settings.directorProvider).toBe('anthropic')
    expect(next.settings.directorBaseUrl).toBe('https://api.anthropic.com/v1')
  })

  // ── Memory Ops Status ──────────────────────────────────────────────

  test('creates a default memory ops status with zero timestamps and empty counts', () => {
    const status = createDefaultMemoryOpsStatus()

    expect(status.lastExtractTs).toBe(0)
    expect(status.lastDreamTs).toBe(0)
    expect(status.notebookFreshness).toBe('unknown')
    expect(status.documentCounts.summaries).toBe(0)
    expect(status.documentCounts.continuityFacts).toBe(0)
    expect(status.documentCounts.worldFacts).toBe(0)
    expect(status.documentCounts.entities).toBe(0)
    expect(status.documentCounts.relations).toBe(0)
    expect(status.fallbackRetrievalEnabled).toBe(false)
    expect(status.isMemoryLocked).toBe(false)
    expect(status.staleWarnings).toEqual([])
    expect(status.recalledDocs).toEqual([])
  })

  test('computes document counts from canonical memory state', () => {
    const state = createEmptyState()
    state.memory.summaries.push(
      { id: 's1', text: 'a', recencyWeight: 1, updatedAt: 1 },
      { id: 's2', text: 'b', recencyWeight: 1, updatedAt: 2 },
    )
    state.memory.continuityFacts.push({ id: 'f1', text: 'x', priority: 5 })
    state.memory.worldFacts.push({ id: 'w1', text: 'w', updatedAt: 1 })
    state.memory.entities.push({ id: 'e1', name: 'E', facts: [], updatedAt: 1 })
    state.memory.relations.push({
      id: 'r1', sourceId: 'e1', label: 'knows', targetId: 'e2', updatedAt: 1,
    })

    const counts = computeDocumentCounts(state.memory)
    expect(counts.summaries).toBe(2)
    expect(counts.continuityFacts).toBe(1)
    expect(counts.worldFacts).toBe(1)
    expect(counts.entities).toBe(1)
    expect(counts.relations).toBe(1)
  })

  test('computes notebook freshness from extract and dream timestamps', () => {
    const now = Date.now()
    expect(computeNotebookFreshness(0, 0)).toBe('unknown')
    expect(computeNotebookFreshness(now - 1000, now - 2000)).toBe('current')
    expect(computeNotebookFreshness(now - 25 * 3600_000, 0)).toBe('stale')
  })

  // ── Diagnostics in MemoryOpsStatus ──────────────────────────────────

  test('default memory ops status includes a default diagnostics snapshot', () => {
    const status = createDefaultMemoryOpsStatus()
    expect(status.diagnostics).toBeDefined()
    expect(status.diagnostics.lastHookKind).toBeNull()
    expect(status.diagnostics.lastErrorMessage).toBeNull()
    expect(status.diagnostics.extraction.health).toBe('idle')
    expect(status.diagnostics.dream.health).toBe('idle')
    expect(status.diagnostics.recovery.health).toBe('idle')
    expect(status.diagnostics.breadcrumbs).toEqual([])
  })
})
