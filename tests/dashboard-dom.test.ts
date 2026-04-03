import { createEmptyState } from '../src/contracts/types.js'
import { DEFAULT_DIRECTOR_PROMPT_PRESET } from '../src/director/prompt.js'
import {
  buildDashboardMarkup,
  DASHBOARD_TABS
} from '../src/ui/dashboardDom.js'
import {
  createDefaultProfileManifest,
  normalizePersistedSettings
} from '../src/ui/dashboardState.js'
import { setLocale } from '../src/ui/i18n.js'

describe('buildDashboardMarkup', () => {
  afterEach(() => {
    setLocale('en')
  })

  test('renders sidebar navigation and page shells for all dashboard tabs', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'general',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: {
        kind: 'idle',
        message: 'Ready to test'
      }
    })

    for (const tab of DASHBOARD_TABS) {
      expect(markup).toContain(`data-da-target="${tab.id}"`)
      expect(markup).toContain(`id="da-page-${tab.id}"`)
    }

    expect(markup).toContain('Director Dashboard')
    expect(markup).toContain('Settings Profiles')
    expect(markup).toContain('Test Connection')
    expect(markup).toContain('Memory & Cache')
  })

  test('renders built-in profile names in Korean when locale is ko', () => {
    setLocale('ko')
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'settings-profiles',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' }
    })

    expect(markup).toContain('균형')
    expect(markup).toContain('부드러움')
    expect(markup).toContain('엄격')
    expect(markup).not.toContain('>Balanced<')
    expect(markup).not.toContain('>Gentle<')
    expect(markup).not.toContain('>Strict<')
  })

  test('renders prompt preset controls on the prompt tuning page', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'prompt-tuning',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' }
    })

    expect(markup).toContain('data-da-role="prompt-preset-select"')
    expect(markup).toContain('data-da-role="prompt-preset-name"')
    expect(markup).toContain('data-da-role="prompt-pre-request-system"')
    expect(markup).toContain('data-da-role="prompt-post-response-user"')
    expect(markup).toContain('data-da-action="create-prompt-preset"')
    expect(markup).toContain(DEFAULT_DIRECTOR_PROMPT_PRESET.preRequestSystemTemplate.slice(0, 32))
  })

  test('renders expanded director and embedding provider controls on the model settings page', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({ embeddingsEnabled: true }),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'model-settings',
      modelOptions: ['gpt-5.4-mini'],
      connectionStatus: { kind: 'idle', message: '' }
    })

    expect(markup).toContain('value="copilot"')
    expect(markup).toContain('value="vertex"')
    expect(markup).toContain('data-da-field="embeddingProvider"')
    expect(markup).toContain('data-da-field="embeddingBaseUrl"')
    expect(markup).toContain('data-da-field="embeddingApiKey"')
    expect(markup).toContain('data-da-field="embeddingModel"')
    expect(markup).toContain('data-da-field="embeddingDimensions"')
    expect(markup).toContain('value="voyageai"')
  })

  test('renders a current-chat backfill action on the memory page', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-5.4-mini'],
      connectionStatus: { kind: 'idle', message: '' },
    })

    expect(markup).toContain('data-da-action="backfill-current-chat"')
    expect(markup).toContain('data-da-action="regenerate-current-chat"')
  })

  test('escapes settings field values and model option ids in model-settings markup', () => {
    const injectedValue = 'https://api.example.com/v1" data-evil="1'
    const injectedModel = 'gpt-bad" data-evil="1'

    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({
        directorBaseUrl: injectedValue,
        directorApiKey: injectedValue,
        directorModel: injectedModel,
        embeddingBaseUrl: injectedValue,
        embeddingApiKey: injectedValue,
        embeddingModel: injectedModel,
      }),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'model-settings',
      modelOptions: [injectedModel],
      connectionStatus: { kind: 'idle', message: '' },
    })

    expect(markup).not.toContain('data-evil="1"')
    expect(markup).toContain('&quot;')
  })
})
