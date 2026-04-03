import type { RisuaiApi } from '../contracts/risuai.js'
import type { DirectorSettings } from '../contracts/types.js'
import { DEFAULT_DIRECTOR_SETTINGS } from '../contracts/types.js'

export interface PluginUiOptions {
  onOpen: () => Promise<void> | void
}

const SETTING_NAME = 'Director Settings'
const BUTTON_NAME = 'Director'
const BUTTON_ICON = '🎬'

/**
 * Show a settings overview via api.alert (safe fallback that works in all environments).
 */
export async function showSettingsOverlay(
  api: RisuaiApi,
  settings: DirectorSettings = DEFAULT_DIRECTOR_SETTINGS
): Promise<void> {
  const lines = [
    `── Director Plugin Settings ──`,
    `Enabled: ${String(settings.enabled)}`,
    `Assertiveness: ${settings.assertiveness}`,
    `Model: ${settings.directorModel}`,
    `Injection: ${settings.injectionMode}`,
    `Post-review: ${String(settings.postReviewEnabled)}`,
    `Brief cap: ${String(settings.briefTokenCap)} tokens`,
  ]
  await api.alert(lines.join('\n'))
}

/**
 * Register the plugin's UI entry points:
 * - A settings panel entry (gear menu)
 * - A chat button entry (chat toolbar)
 *
 * Both invoke `options.onOpen` when clicked.
 */
export async function registerPluginUi(
  api: RisuaiApi,
  options: PluginUiOptions,
): Promise<void> {
  await api.registerSetting(
    SETTING_NAME,
    async () => { await options.onOpen() },
    BUTTON_ICON,
    'html',
  )

  await api.registerButton(
    {
      name: BUTTON_NAME,
      icon: BUTTON_ICON,
      iconType: 'html',
      location: 'chat',
    },
    async () => { await options.onOpen() },
  )
}
