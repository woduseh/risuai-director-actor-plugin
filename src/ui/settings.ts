import type { RisuaiApi } from '../contracts/risuai.js'
import type { DirectorSettings } from '../contracts/types.js'
import { DEFAULT_DIRECTOR_SETTINGS } from '../contracts/types.js'
import { openDashboard, closeDashboard } from './dashboardApp.js'
import type { DashboardStore } from './dashboardApp.js'
import { t } from './i18n.js'

export interface PluginUiOptions {
  onOpen: () => Promise<void> | void
}

const SETTING_NAME = 'Director Settings'
const BUTTON_NAME = 'Director'
const BUTTON_ICON = '🎬'
const SETTING_ID = 'director-dashboard-settings'
const BUTTON_ID = 'director-dashboard-button'

function buildFallbackSummary(settings: DirectorSettings): string {
  return [
    t('fallback.header'),
    `${t('fallback.enabled')}: ${String(settings.enabled)}`,
    `${t('fallback.assertiveness')}: ${settings.assertiveness}`,
    `${t('fallback.provider')}: ${settings.directorProvider}`,
    `${t('fallback.model')}: ${settings.directorModel}`,
    `${t('fallback.injection')}: ${settings.injectionMode}`,
    `${t('fallback.postReview')}: ${String(settings.postReviewEnabled)}`,
    `${t('fallback.briefCap')}: ${String(settings.briefTokenCap)} ${t('fallback.briefCapUnit')}`
  ].join('\n')
}

/**
 * Open the fullscreen dashboard when called from a plugin container context.
 * Falls back to a plain alert summary in non-browser test environments.
 */
export async function showSettingsOverlay(
  api: RisuaiApi,
  settings: DirectorSettings = DEFAULT_DIRECTOR_SETTINGS,
  dashboardStore?: DashboardStore,
): Promise<void> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    await api.alert(buildFallbackSummary(settings))
    return
  }

  const store: DashboardStore = dashboardStore ?? { storage: api.pluginStorage }
  await openDashboard(api, store)
}

/**
 * Register the plugin's UI entry points:
 * - a settings item
 * - a chat button
 *
 * Both point at the same dashboard launcher.
 */
export async function registerPluginUi(
  api: RisuaiApi,
  options: PluginUiOptions
): Promise<void> {
  await api.registerSetting(
    SETTING_NAME,
    async () => { await options.onOpen() },
    BUTTON_ICON,
    'html',
    SETTING_ID
  )

  await api.registerButton(
    {
      name: BUTTON_NAME,
      icon: BUTTON_ICON,
      iconType: 'html',
      location: 'chat',
      id: BUTTON_ID
    },
    async () => { await options.onOpen() }
  )

  await api.onUnload(async () => {
    await closeDashboard()
  })
}
