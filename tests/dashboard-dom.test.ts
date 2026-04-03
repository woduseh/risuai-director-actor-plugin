import { createEmptyState } from '../src/contracts/types.js'
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
})
