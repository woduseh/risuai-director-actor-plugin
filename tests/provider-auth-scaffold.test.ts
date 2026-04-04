/**
 * @vitest-environment jsdom
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { DEFAULT_DIRECTOR_SETTINGS, createEmptyState } from '../src/contracts/types.js'
import type { DirectorSettings } from '../src/contracts/types.js'
import {
  normalizePersistedSettings,
  createDefaultProfileManifest,
} from '../src/ui/dashboardState.js'
import {
  directorAuthFields,
  embeddingAuthFields,
} from '../src/ui/dashboardModel.js'
import { buildDashboardMarkup } from '../src/ui/dashboardDom.js'
import { t, setLocale, CATALOGS } from '../src/ui/i18n.js'
import { createMockRisuaiApi } from './helpers/mockRisuai.js'
import { openDashboard, closeDashboard } from '../src/ui/dashboardApp.js'
import type { DashboardStore } from '../src/ui/dashboardApp.js'
import {
  DASHBOARD_SETTINGS_KEY,
} from '../src/ui/dashboardState.js'
import { DASHBOARD_ROOT_CLASS } from '../src/ui/dashboardCss.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultMarkupInput(overrides?: Partial<DirectorSettings>) {
  return {
    settings: normalizePersistedSettings(overrides ?? {}),
    pluginState: createEmptyState(),
    profiles: createDefaultProfileManifest(),
    activeTab: 'model-settings',
    modelOptions: ['gpt-4.1-mini'],
    connectionStatus: { kind: 'idle' as const, message: '' },
  }
}

function createTestStore(
  api: ReturnType<typeof createMockRisuaiApi>,
): DashboardStore {
  return { storage: api.pluginStorage }
}

// ===========================================================================
// 1. Settings defaults & normalization
// ===========================================================================

describe('provider auth – settings defaults', () => {
  test('DEFAULT_DIRECTOR_SETTINGS includes empty Copilot token', () => {
    expect(DEFAULT_DIRECTOR_SETTINGS.directorCopilotToken).toBe('')
  })

  test('DEFAULT_DIRECTOR_SETTINGS includes empty Vertex director fields', () => {
    expect(DEFAULT_DIRECTOR_SETTINGS.directorVertexJsonKey).toBe('')
    expect(DEFAULT_DIRECTOR_SETTINGS.directorVertexProject).toBe('')
    expect(DEFAULT_DIRECTOR_SETTINGS.directorVertexLocation).toBe('')
  })

  test('DEFAULT_DIRECTOR_SETTINGS includes empty Vertex embedding fields', () => {
    expect(DEFAULT_DIRECTOR_SETTINGS.embeddingVertexJsonKey).toBe('')
    expect(DEFAULT_DIRECTOR_SETTINGS.embeddingVertexProject).toBe('')
    expect(DEFAULT_DIRECTOR_SETTINGS.embeddingVertexLocation).toBe('')
  })

  test('normalizePersistedSettings preserves provided Copilot token', () => {
    const settings = normalizePersistedSettings({
      directorCopilotToken: 'ghu_testtoken123',
    })
    expect(settings.directorCopilotToken).toBe('ghu_testtoken123')
  })

  test('normalizePersistedSettings preserves provided Vertex fields', () => {
    const settings = normalizePersistedSettings({
      directorVertexJsonKey: '{"type":"service_account"}',
      directorVertexProject: 'my-project',
      directorVertexLocation: 'us-central1',
    })
    expect(settings.directorVertexJsonKey).toBe('{"type":"service_account"}')
    expect(settings.directorVertexProject).toBe('my-project')
    expect(settings.directorVertexLocation).toBe('us-central1')
  })

  test('normalizePersistedSettings fills defaults for missing new fields', () => {
    const settings = normalizePersistedSettings({})
    expect(settings.directorCopilotToken).toBe('')
    expect(settings.directorVertexJsonKey).toBe('')
    expect(settings.directorVertexProject).toBe('')
    expect(settings.directorVertexLocation).toBe('')
    expect(settings.embeddingVertexJsonKey).toBe('')
    expect(settings.embeddingVertexProject).toBe('')
    expect(settings.embeddingVertexLocation).toBe('')
  })

  test('normalizePersistedSettings preserves embedding Vertex fields', () => {
    const settings = normalizePersistedSettings({
      embeddingVertexJsonKey: '{"embedding":"key"}',
      embeddingVertexProject: 'embed-project',
      embeddingVertexLocation: 'europe-west1',
    })
    expect(settings.embeddingVertexJsonKey).toBe('{"embedding":"key"}')
    expect(settings.embeddingVertexProject).toBe('embed-project')
    expect(settings.embeddingVertexLocation).toBe('europe-west1')
  })
})

// ===========================================================================
// 2. dashboardModel – auth field helpers
// ===========================================================================

describe('provider auth – directorAuthFields', () => {
  test('returns baseUrl and apiKey for openai', () => {
    const fields = directorAuthFields('openai')
    const fieldNames = fields.map((f) => f.field)
    expect(fieldNames).toContain('directorBaseUrl')
    expect(fieldNames).toContain('directorApiKey')
    expect(fieldNames).not.toContain('directorCopilotToken')
    expect(fieldNames).not.toContain('directorVertexJsonKey')
  })

  test('returns baseUrl and apiKey for anthropic', () => {
    const fields = directorAuthFields('anthropic')
    const fieldNames = fields.map((f) => f.field)
    expect(fieldNames).toContain('directorBaseUrl')
    expect(fieldNames).toContain('directorApiKey')
  })

  test('returns copilot token field for copilot provider', () => {
    const fields = directorAuthFields('copilot')
    const fieldNames = fields.map((f) => f.field)
    expect(fieldNames).toContain('directorCopilotToken')
    expect(fieldNames).not.toContain('directorApiKey')
    expect(fieldNames).not.toContain('directorBaseUrl')
  })

  test('copilot token field uses password input type', () => {
    const fields = directorAuthFields('copilot')
    const tokenField = fields.find((f) => f.field === 'directorCopilotToken')
    expect(tokenField).toBeDefined()
    expect(tokenField!.inputType).toBe('password')
  })

  test('returns vertex-specific fields for vertex provider', () => {
    const fields = directorAuthFields('vertex')
    const fieldNames = fields.map((f) => f.field)
    expect(fieldNames).toContain('directorVertexJsonKey')
    expect(fieldNames).toContain('directorVertexProject')
    expect(fieldNames).toContain('directorVertexLocation')
    expect(fieldNames).not.toContain('directorApiKey')
    expect(fieldNames).not.toContain('directorBaseUrl')
  })

  test('vertex JSON key uses textarea input type', () => {
    const fields = directorAuthFields('vertex')
    const jsonField = fields.find((f) => f.field === 'directorVertexJsonKey')
    expect(jsonField).toBeDefined()
    expect(jsonField!.inputType).toBe('textarea')
  })

  test('returns baseUrl and apiKey for custom provider', () => {
    const fields = directorAuthFields('custom')
    const fieldNames = fields.map((f) => f.field)
    expect(fieldNames).toContain('directorBaseUrl')
    expect(fieldNames).toContain('directorApiKey')
  })
})

describe('provider auth – embeddingAuthFields', () => {
  test('returns standard fields for openai', () => {
    const fields = embeddingAuthFields('openai')
    const fieldNames = fields.map((f) => f.field)
    expect(fieldNames).toContain('embeddingBaseUrl')
    expect(fieldNames).toContain('embeddingApiKey')
    expect(fieldNames).not.toContain('embeddingVertexJsonKey')
  })

  test('returns vertex-specific fields for vertex provider', () => {
    const fields = embeddingAuthFields('vertex')
    const fieldNames = fields.map((f) => f.field)
    expect(fieldNames).toContain('embeddingVertexJsonKey')
    expect(fieldNames).toContain('embeddingVertexProject')
    expect(fieldNames).toContain('embeddingVertexLocation')
    expect(fieldNames).not.toContain('embeddingApiKey')
    expect(fieldNames).not.toContain('embeddingBaseUrl')
  })

  test('vertex embedding JSON key uses textarea input type', () => {
    const fields = embeddingAuthFields('vertex')
    const jsonField = fields.find((f) => f.field === 'embeddingVertexJsonKey')
    expect(jsonField).toBeDefined()
    expect(jsonField!.inputType).toBe('textarea')
  })
})

// ===========================================================================
// 3. Dashboard DOM – provider-specific rendering
// ===========================================================================

describe('provider auth – dashboard DOM rendering', () => {
  afterEach(() => {
    setLocale('en')
  })

  test('renders standard baseUrl + apiKey fields when provider is openai', () => {
    const markup = buildDashboardMarkup(defaultMarkupInput({ directorProvider: 'openai' }))
    expect(markup).toContain('data-cd-field="directorBaseUrl"')
    expect(markup).toContain('data-cd-field="directorApiKey"')
    expect(markup).not.toContain('data-cd-field="directorCopilotToken"')
    expect(markup).not.toContain('data-cd-field="directorVertexJsonKey"')
  })

  test('renders Copilot token field when provider is copilot', () => {
    const markup = buildDashboardMarkup(defaultMarkupInput({ directorProvider: 'copilot' }))
    expect(markup).toContain('data-cd-field="directorCopilotToken"')
    expect(markup).not.toContain('data-cd-field="directorApiKey"')
    // Should not show generic base URL for copilot
    expect(markup).not.toContain('data-cd-field="directorBaseUrl"')
  })

  test('renders Copilot token label text', () => {
    const markup = buildDashboardMarkup(defaultMarkupInput({ directorProvider: 'copilot' }))
    expect(markup).toContain(t('label.copilotToken'))
  })

  test('renders Vertex fields when provider is vertex', () => {
    const markup = buildDashboardMarkup(defaultMarkupInput({ directorProvider: 'vertex' }))
    expect(markup).toContain('data-cd-field="directorVertexJsonKey"')
    expect(markup).toContain('data-cd-field="directorVertexProject"')
    expect(markup).toContain('data-cd-field="directorVertexLocation"')
    expect(markup).not.toContain('data-cd-field="directorApiKey"')
    expect(markup).not.toContain('data-cd-field="directorBaseUrl"')
  })

  test('renders Vertex JSON key as a textarea element', () => {
    const markup = buildDashboardMarkup(defaultMarkupInput({ directorProvider: 'vertex' }))
    expect(markup).toMatch(/<textarea[^>]*data-cd-field="directorVertexJsonKey"/)
  })

  test('renders Vertex embedding fields when embedding provider is vertex', () => {
    const markup = buildDashboardMarkup(defaultMarkupInput({ embeddingProvider: 'vertex' }))
    expect(markup).toContain('data-cd-field="embeddingVertexJsonKey"')
    expect(markup).toContain('data-cd-field="embeddingVertexProject"')
    expect(markup).toContain('data-cd-field="embeddingVertexLocation"')
    expect(markup).not.toContain('data-cd-field="embeddingApiKey"')
    expect(markup).not.toContain('data-cd-field="embeddingBaseUrl"')
  })

  test('renders standard embedding fields when embedding provider is openai', () => {
    const markup = buildDashboardMarkup(defaultMarkupInput({ embeddingProvider: 'openai' }))
    expect(markup).toContain('data-cd-field="embeddingBaseUrl"')
    expect(markup).toContain('data-cd-field="embeddingApiKey"')
    expect(markup).not.toContain('data-cd-field="embeddingVertexJsonKey"')
  })
})

// ===========================================================================
// 4. i18n – new provider auth labels
// ===========================================================================

describe('provider auth – i18n labels', () => {
  afterEach(() => {
    setLocale('en')
  })

  test('EN catalog has Copilot token label', () => {
    expect(t('label.copilotToken')).toBe('Copilot Token')
  })

  test('EN catalog has Vertex auth labels', () => {
    expect(t('label.vertexJsonKey')).toBeTruthy()
    expect(t('label.vertexProject')).toBeTruthy()
    expect(t('label.vertexLocation')).toBeTruthy()
  })

  test('EN catalog has embedding Vertex labels', () => {
    expect(t('label.embeddingVertexJsonKey')).toBeTruthy()
    expect(t('label.embeddingVertexProject')).toBeTruthy()
    expect(t('label.embeddingVertexLocation')).toBeTruthy()
  })

  test('EN and KO catalogs have identical key sets including new labels', () => {
    const enKeys = Object.keys(CATALOGS.en).sort()
    const koKeys = Object.keys(CATALOGS.ko).sort()
    expect(enKeys).toEqual(koKeys)
  })

  test('KO catalog has non-empty Copilot token label', () => {
    setLocale('ko')
    const value = t('label.copilotToken')
    expect(value.length).toBeGreaterThan(0)
  })

  test('KO catalog has non-empty Vertex auth labels', () => {
    setLocale('ko')
    expect(t('label.vertexJsonKey').length).toBeGreaterThan(0)
    expect(t('label.vertexProject').length).toBeGreaterThan(0)
    expect(t('label.vertexLocation').length).toBeGreaterThan(0)
  })

  test('EN has help text for Copilot token', () => {
    expect(t('help.copilotToken')).toBeTruthy()
    expect(t('help.copilotToken')).not.toBe('help.copilotToken')
  })

  test('EN has help text for Vertex JSON key', () => {
    expect(t('help.vertexJsonKey')).toBeTruthy()
    expect(t('help.vertexJsonKey')).not.toBe('help.vertexJsonKey')
  })
})

// ===========================================================================
// 5. Dashboard App – provider switch preserves unrelated auth fields
// ===========================================================================

describe('provider auth – dashboard app wiring', () => {
  let api: ReturnType<typeof createMockRisuaiApi>
  let store: DashboardStore

  beforeEach(() => {
    api = createMockRisuaiApi()
    store = createTestStore(api)
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  afterEach(async () => {
    await closeDashboard()
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  test('switching director provider to copilot does not clobber Vertex fields', async () => {
    await api.pluginStorage.setItem(DASHBOARD_SETTINGS_KEY, {
      ...DEFAULT_DIRECTOR_SETTINGS,
      directorProvider: 'vertex',
      directorVertexJsonKey: '{"type":"service_account"}',
      directorVertexProject: 'my-project',
      directorVertexLocation: 'us-central1',
    })
    await openDashboard(api, store)

    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const select = root.querySelector(
      '[data-cd-field="directorProvider"]',
    ) as HTMLSelectElement
    expect(select).not.toBeNull()

    select.value = 'copilot'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 50))

    // Save
    const saveBtn = root.querySelector('[data-cd-action="save"]') as HTMLElement
    saveBtn.click()
    await new Promise((r) => setTimeout(r, 50))

    const stored = (await api.pluginStorage.getItem(
      DASHBOARD_SETTINGS_KEY,
    )) as DirectorSettings
    expect(stored.directorProvider).toBe('copilot')
    expect(stored.directorVertexJsonKey).toBe('{"type":"service_account"}')
    expect(stored.directorVertexProject).toBe('my-project')
  })

  test('switching director provider to openai does not clobber Copilot token', async () => {
    await api.pluginStorage.setItem(DASHBOARD_SETTINGS_KEY, {
      ...DEFAULT_DIRECTOR_SETTINGS,
      directorProvider: 'copilot',
      directorCopilotToken: 'ghu_abc123',
    })
    await openDashboard(api, store)

    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const select = root.querySelector(
      '[data-cd-field="directorProvider"]',
    ) as HTMLSelectElement

    select.value = 'openai'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 50))

    const saveBtn = root.querySelector('[data-cd-action="save"]') as HTMLElement
    saveBtn.click()
    await new Promise((r) => setTimeout(r, 50))

    const stored = (await api.pluginStorage.getItem(
      DASHBOARD_SETTINGS_KEY,
    )) as DirectorSettings
    expect(stored.directorProvider).toBe('openai')
    expect(stored.directorCopilotToken).toBe('ghu_abc123')
  })

  test('copilot token field in DOM is bound and updates draft', async () => {
    await api.pluginStorage.setItem(DASHBOARD_SETTINGS_KEY, {
      ...DEFAULT_DIRECTOR_SETTINGS,
      directorProvider: 'copilot',
    })
    await openDashboard(api, store)

    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    // Navigate to model-settings tab
    const modelTab = root.querySelector(
      '[data-cd-target="model-settings"]',
    ) as HTMLElement
    modelTab?.click()
    await new Promise((r) => setTimeout(r, 50))

    const tokenInput = root.querySelector(
      '[data-cd-field="directorCopilotToken"]',
    ) as HTMLInputElement
    expect(tokenInput).not.toBeNull()

    tokenInput.value = 'ghu_new_token'
    tokenInput.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 50))

    // Save and verify
    const saveBtn = root.querySelector('[data-cd-action="save"]') as HTMLElement
    saveBtn.click()
    await new Promise((r) => setTimeout(r, 50))

    const stored = (await api.pluginStorage.getItem(
      DASHBOARD_SETTINGS_KEY,
    )) as DirectorSettings
    expect(stored.directorCopilotToken).toBe('ghu_new_token')
  })

  test('vertex fields in DOM are bound and update draft', async () => {
    await api.pluginStorage.setItem(DASHBOARD_SETTINGS_KEY, {
      ...DEFAULT_DIRECTOR_SETTINGS,
      directorProvider: 'vertex',
    })
    await openDashboard(api, store)

    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const modelTab = root.querySelector(
      '[data-cd-target="model-settings"]',
    ) as HTMLElement
    modelTab?.click()
    await new Promise((r) => setTimeout(r, 50))

    const projectInput = root.querySelector(
      '[data-cd-field="directorVertexProject"]',
    ) as HTMLInputElement
    expect(projectInput).not.toBeNull()

    projectInput.value = 'my-gcp-project'
    projectInput.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 50))

    const locationInput = root.querySelector(
      '[data-cd-field="directorVertexLocation"]',
    ) as HTMLInputElement
    locationInput.value = 'us-east4'
    locationInput.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 50))

    // Save and verify
    const saveBtn = root.querySelector('[data-cd-action="save"]') as HTMLElement
    saveBtn.click()
    await new Promise((r) => setTimeout(r, 50))

    const stored = (await api.pluginStorage.getItem(
      DASHBOARD_SETTINGS_KEY,
    )) as DirectorSettings
    expect(stored.directorVertexProject).toBe('my-gcp-project')
    expect(stored.directorVertexLocation).toBe('us-east4')
  })

  test('provider switch re-renders auth fields in DOM', async () => {
    await api.pluginStorage.setItem(DASHBOARD_SETTINGS_KEY, {
      ...DEFAULT_DIRECTOR_SETTINGS,
      directorProvider: 'openai',
    })
    await openDashboard(api, store)

    let root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const modelTab = root.querySelector(
      '[data-cd-target="model-settings"]',
    ) as HTMLElement
    modelTab?.click()
    await new Promise((r) => setTimeout(r, 50))

    // Initially should show standard fields
    expect(root.querySelector('[data-cd-field="directorApiKey"]')).not.toBeNull()
    expect(root.querySelector('[data-cd-field="directorCopilotToken"]')).toBeNull()

    // Switch to copilot
    const select = root.querySelector(
      '[data-cd-field="directorProvider"]',
    ) as HTMLSelectElement
    select.value = 'copilot'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 50))

    // Re-query root after fullReRender
    root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    expect(root).not.toBeNull()

    // After switch, copilot token should appear, apiKey should not
    expect(root.querySelector('[data-cd-field="directorCopilotToken"]')).not.toBeNull()
    expect(root.querySelector('[data-cd-field="directorApiKey"]')).toBeNull()
  })
})
