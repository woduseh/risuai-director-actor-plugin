import { createEmptyState } from '../src/contracts/types.js'
import {
  buildDashboardMarkup,
  DASHBOARD_TABS
} from '../src/ui/dashboardDom.js'
import {
  createDefaultProfileManifest,
  normalizePersistedSettings
} from '../src/ui/dashboardState.js'

describe('buildDashboardMarkup', () => {
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
})
