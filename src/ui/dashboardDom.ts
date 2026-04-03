import type { DirectorSettings, DirectorPluginState } from '../contracts/types.js'
import type { ProfileManifest } from './dashboardState.js'
import { DASHBOARD_ROOT_CLASS } from './dashboardCss.js'
import { t, tabLabel, sidebarGroupLabel, profileDisplayName, getLocale } from './i18n.js'
import type { DashboardLocale } from './i18n.js'

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

export interface DashboardTab {
  id: string
  labelKey: string
  group: 'general' | 'tuning' | 'memory' | 'profiles'
}

export const DASHBOARD_TABS: readonly DashboardTab[] = [
  { id: 'general', labelKey: 'general', group: 'general' },
  { id: 'prompt-tuning', labelKey: 'prompt-tuning', group: 'tuning' },
  { id: 'model-settings', labelKey: 'model-settings', group: 'tuning' },
  { id: 'memory-cache', labelKey: 'memory-cache', group: 'memory' },
  { id: 'settings-profiles', labelKey: 'settings-profiles', group: 'profiles' },
] as const

// ---------------------------------------------------------------------------
// Markup input
// ---------------------------------------------------------------------------

export interface DashboardMarkupInput {
  settings: DirectorSettings
  pluginState: DirectorPluginState
  profiles: ProfileManifest
  activeTab: string
  modelOptions: string[]
  connectionStatus: {
    kind: string
    message: string
  }
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function buildSidebar(activeTab: string): string {
  const groups: Array<{ id: DashboardTab['group']; labelId: string }> = [
    { id: 'general', labelId: 'general' },
    { id: 'tuning', labelId: 'tuning' },
    { id: 'memory', labelId: 'memory' },
    { id: 'profiles', labelId: 'profiles' }
  ]

  const sections = groups
    .map((group) => {
      const buttons = DASHBOARD_TABS
        .filter((tab) => tab.group === group.id)
        .map((tab) => {
          const activeClass = tab.id === activeTab ? ' da-sidebar-btn--active' : ''
          return `<button class="da-sidebar-btn${activeClass}" data-da-target="${tab.id}"><span>${tabLabel(tab.id)}</span><span aria-hidden="true">›</span></button>`
        })
        .join('\n')

      return `<section class="da-nav-group"><div class="da-nav-group-label">${sidebarGroupLabel(group.id)}</div>${buttons}</section>`
    })
    .join('\n')

  const currentLocale = getLocale()
  const nextLocale: DashboardLocale = currentLocale === 'en' ? 'ko' : 'en'
  const nextLabel = currentLocale === 'en' ? t('lang.ko') : t('lang.en')

  return `
    <aside class="da-sidebar">
      <div class="da-sidebar-header">
        <div class="da-kicker">${t('sidebar.kicker')}</div>
        <h1 class="da-title">${t('sidebar.title')}</h1>
        <p class="da-subtitle">${t('sidebar.subtitle')}</p>
      </div>
      <nav class="da-sidebar-nav">${sections}</nav>
      <div class="da-sidebar-footer da-footer">
        <button class="da-btn" data-da-action="switch-lang" data-da-lang="${nextLocale}">${nextLabel}</button>
        <button class="da-btn da-btn--ghost" data-da-action="export-settings">${t('btn.exportSettings')}</button>
        <button class="da-btn da-btn--danger da-close-btn" data-da-action="close-dashboard">${t('btn.close')}</button>
      </div>
    </aside>`
}

// ---------------------------------------------------------------------------
// Page shells
// ---------------------------------------------------------------------------

function buildGeneralPage(input: DashboardMarkupInput): string {
  const { settings, connectionStatus } = input
  return `
      <div class="da-grid">
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t('card.pluginStatus.title')}</h3>
              <p class="da-card-copy">${t('card.pluginStatus.copy')}</p>
            </div>
            <span class="da-badge" data-kind="${connectionStatus.kind === 'error' ? 'error' : connectionStatus.kind === 'success' ? 'success' : 'neutral'}">${connectionStatus.kind}</span>
          </div>
          <label class="da-toggle">
            <input type="checkbox" data-da-field="enabled"${settings.enabled ? ' checked' : ''} />
            <span class="da-toggle-track"><span class="da-toggle-dot"></span></span>
            <span>${t('label.enabled')}</span>
          </label>
          <label class="da-label">
            <span class="da-label-text">${t('label.assertiveness')}</span>
            <select class="da-select" data-da-field="assertiveness">
            <option value="light"${settings.assertiveness === 'light' ? ' selected' : ''}>${t('option.light')}</option>
            <option value="standard"${settings.assertiveness === 'standard' ? ' selected' : ''}>${t('option.standard')}</option>
            <option value="firm"${settings.assertiveness === 'firm' ? ' selected' : ''}>${t('option.firm')}</option>
            </select>
          </label>
          <div class="da-inline">
            <label class="da-label">
              <span class="da-label-text">${t('label.mode')}</span>
              <select class="da-select" data-da-field="directorMode">
                <option value="otherAx"${settings.directorMode === 'otherAx' ? ' selected' : ''}>${t('option.risuAux')}</option>
                <option value="model"${settings.directorMode === 'model' ? ' selected' : ''}>${t('option.independentProvider')}</option>
              </select>
            </label>
            <label class="da-label">
              <span class="da-label-text">${t('label.injectionMode')}</span>
              <select class="da-select" data-da-field="injectionMode">
                <option value="auto"${settings.injectionMode === 'auto' ? ' selected' : ''}>${t('option.auto')}</option>
                <option value="author-note"${settings.injectionMode === 'author-note' ? ' selected' : ''}>${t('option.authorNote')}</option>
                <option value="adjacent-user"${settings.injectionMode === 'adjacent-user' ? ' selected' : ''}>${t('option.adjacentUser')}</option>
                <option value="post-constraint"${settings.injectionMode === 'post-constraint' ? ' selected' : ''}>${t('option.postConstraint')}</option>
                <option value="bottom"${settings.injectionMode === 'bottom' ? ' selected' : ''}>${t('option.bottom')}</option>
              </select>
            </label>
          </div>
          <span class="da-connection-status" data-da-status="${connectionStatus.kind}">${connectionStatus.message}</span>
        </section>
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t('card.metricsSnapshot.title')}</h3>
              <p class="da-card-copy">${t('card.metricsSnapshot.copy')}</p>
            </div>
          </div>
          <ul class="da-metric-list">
            <li class="da-metric-item"><span>${t('metric.totalDirectorCalls')}</span><strong>${input.pluginState.metrics.totalDirectorCalls}</strong></li>
            <li class="da-metric-item"><span>${t('metric.totalFailures')}</span><strong>${input.pluginState.metrics.totalDirectorFailures}</strong></li>
            <li class="da-metric-item"><span>${t('metric.memoryWrites')}</span><strong>${input.pluginState.metrics.totalMemoryWrites}</strong></li>
            <li class="da-metric-item"><span>${t('metric.scenePhase')}</span><strong>${input.pluginState.director.scenePhase}</strong></li>
          </ul>
        </section>
      </div>`
}

function buildPromptTuningPage(input: DashboardMarkupInput): string {
  const { settings } = input
  return `
      <div class="da-grid">
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t('card.promptTuning.title')}</h3>
              <p class="da-card-copy">${t('card.promptTuning.copy')}</p>
            </div>
          </div>
          <div class="da-form-grid">
            <label class="da-label">
              <span class="da-label-text">${t('label.briefTokenCap')}</span>
              <input type="number" class="da-input" data-da-field="briefTokenCap" value="${settings.briefTokenCap}" />
            </label>
            <label class="da-toggle">
              <input type="checkbox" data-da-field="postReviewEnabled"${settings.postReviewEnabled ? ' checked' : ''} />
              <span class="da-toggle-track"><span class="da-toggle-dot"></span></span>
              <span>${t('label.postReview')}</span>
            </label>
            <label class="da-toggle">
              <input type="checkbox" data-da-field="embeddingsEnabled"${settings.embeddingsEnabled ? ' checked' : ''} />
              <span class="da-toggle-track"><span class="da-toggle-dot"></span></span>
              <span>${t('label.embeddings')}</span>
            </label>
          </div>
        </section>
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t('card.timingLimits.title')}</h3>
              <p class="da-card-copy">${t('card.timingLimits.copy')}</p>
            </div>
          </div>
          <div class="da-form-grid">
            <label class="da-label">
              <span class="da-label-text">${t('label.cooldownFailures')}</span>
              <input type="number" class="da-input" data-da-field="cooldownFailureThreshold" value="${settings.cooldownFailureThreshold}" />
            </label>
            <label class="da-label">
              <span class="da-label-text">${t('label.cooldownMs')}</span>
              <input type="number" class="da-input" data-da-field="cooldownMs" value="${settings.cooldownMs}" />
            </label>
            <label class="da-label">
              <span class="da-label-text">${t('label.outputDebounceMs')}</span>
              <input type="number" class="da-input" data-da-field="outputDebounceMs" value="${settings.outputDebounceMs}" />
            </label>
          </div>
        </section>
      </div>`
}

function buildModelSettingsPage(input: DashboardMarkupInput): string {
  const { settings, modelOptions } = input
  const modelOptionEls = modelOptions
    .map((m) => `<option value="${m}"${m === settings.directorModel ? ' selected' : ''}>${m}</option>`)
    .join('')
  return `
      <div class="da-grid">
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t('card.directorModel.title')}</h3>
              <p class="da-card-copy">${t('card.directorModel.copy')}</p>
            </div>
          </div>
          <div class="da-form-grid">
            <label class="da-label">
              <span class="da-label-text">${t('label.provider')}</span>
              <select class="da-select" data-da-field="directorProvider">
                <option value="openai"${settings.directorProvider === 'openai' ? ' selected' : ''}>${t('option.openai')}</option>
                <option value="anthropic"${settings.directorProvider === 'anthropic' ? ' selected' : ''}>${t('option.anthropic')}</option>
                <option value="google"${settings.directorProvider === 'google' ? ' selected' : ''}>${t('option.google')}</option>
                <option value="custom"${settings.directorProvider === 'custom' ? ' selected' : ''}>${t('option.custom')}</option>
              </select>
            </label>
            <div class="da-split">
              <label class="da-label">
                <span class="da-label-text">${t('label.baseUrl')}</span>
                <input type="text" class="da-input" data-da-field="directorBaseUrl" value="${settings.directorBaseUrl}" />
              </label>
              <label class="da-label">
                <span class="da-label-text">${t('label.apiKey')}</span>
                <input type="password" class="da-input" data-da-field="directorApiKey" value="${settings.directorApiKey}" />
              </label>
            </div>
            <label class="da-label">
              <span class="da-label-text">${t('label.model')}</span>
              <select class="da-select" data-da-field="directorModel">${modelOptionEls}</select>
            </label>
            <label class="da-label">
              <span class="da-label-text">${t('label.customModelId')}</span>
              <input type="text" class="da-input" data-da-field="directorModel" value="${settings.directorModel}" placeholder="type a model ID directly" />
            </label>
            <div class="da-inline">
              <button class="da-btn da-btn--primary" data-da-action="test-connection">${t('btn.testConnection')}</button>
              <button class="da-btn" data-da-action="refresh-models">${t('btn.refreshModels')}</button>
            </div>
          </div>
        </section>
      </div>`
}

function buildMemoryCachePage(_input: DashboardMarkupInput): string {
  return `
      <div class="da-grid">
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t('card.memoryCache.title')}</h3>
              <p class="da-card-copy">${t('card.memoryCache.copy')}</p>
            </div>
          </div>
          <p class="da-hint">${t('card.memoryCache.hint')}</p>
        </section>
      </div>`
}

function buildSettingsProfilesPage(input: DashboardMarkupInput): string {
  const { profiles } = input
  const profileItems = profiles.profiles
    .map((p) => {
      const active = p.id === profiles.activeProfileId ? ' da-profile--active' : ''
      return `<li class="da-profile-item${active}" data-da-profile-id="${p.id}">${profileDisplayName(p.id, p.name)}</li>`
    })
    .join('')
  return `
      <div class="da-grid">
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t('card.settingsProfiles.title')}</h3>
              <p class="da-card-copy">${t('card.settingsProfiles.copy')}</p>
            </div>
          </div>
          <ul class="da-profile-list">${profileItems}</ul>
          <div class="da-inline">
            <button class="da-btn da-btn--primary" data-da-action="create-profile">${t('btn.newProfile')}</button>
            <button class="da-btn" data-da-action="export-profile">${t('btn.export')}</button>
            <button class="da-btn" data-da-action="import-profile">${t('btn.import')}</button>
          </div>
        </section>
      </div>`
}

const PAGE_BUILDERS: Record<string, (input: DashboardMarkupInput) => string> = {
  general: buildGeneralPage,
  'prompt-tuning': buildPromptTuningPage,
  'model-settings': buildModelSettingsPage,
  'memory-cache': buildMemoryCachePage,
  'settings-profiles': buildSettingsProfilesPage,
}

// ---------------------------------------------------------------------------
// Content area
// ---------------------------------------------------------------------------

function buildContent(input: DashboardMarkupInput): string {
  const pages = DASHBOARD_TABS.map((tab) => {
    const hidden = tab.id !== input.activeTab ? ' da-hidden' : ''
    const builder = PAGE_BUILDERS[tab.id]
    const inner = builder ? builder(input) : ''
    return `
    <div class="da-page${hidden}" id="da-page-${tab.id}">
      <h2 class="da-page-title">${tabLabel(tab.id)}</h2>${inner}
    </div>`
  }).join('')

  return `
    <main class="da-content">
      <section class="da-toolbar">
        <div class="da-toolbar-meta">
          <div class="da-kicker">${t('toolbar.kicker')}</div>
          <strong>${t('toolbar.tagline')}</strong>
        </div>
        <div class="da-toolbar-actions">
          <span class="da-dirty-indicator">${t('dirty.unsavedHint')}</span>
          <button class="da-btn da-btn--primary" data-da-action="save-settings">${t('btn.saveChanges')}</button>
          <button class="da-btn" data-da-action="reset-settings">${t('btn.reset')}</button>
        </div>
      </section>${pages}
    </main>`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildDashboardMarkup(input: DashboardMarkupInput): string {
  return `<div class="${DASHBOARD_ROOT_CLASS} da-dashboard">${buildSidebar(input.activeTab)}${buildContent(input)}
</div>`
}
