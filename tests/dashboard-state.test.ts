import { createEmptyState, DEFAULT_DIRECTOR_SETTINGS } from '../src/contracts/types.js'
import {
  createDefaultProfileManifest,
  createDashboardDraft,
  createProfileExportPayload,
  mergeDashboardSettingsIntoPluginState,
  normalizePersistedSettings
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
})
