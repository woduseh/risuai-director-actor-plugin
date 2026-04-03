import type { DirectorSettings, DirectorPluginState } from '../contracts/types.js'
import type { ProfileManifest } from './dashboardState.js'
import { DASHBOARD_ROOT_CLASS } from './dashboardCss.js'

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

export interface DashboardTab {
  id: string
  label: string
  group: 'general' | 'tuning' | 'memory' | 'profiles'
}

export const DASHBOARD_TABS: readonly DashboardTab[] = [
  { id: 'general', label: 'General', group: 'general' },
  { id: 'prompt-tuning', label: 'Prompt Tuning', group: 'tuning' },
  { id: 'model-settings', label: 'Model Settings', group: 'tuning' },
  { id: 'memory-cache', label: 'Memory & Cache', group: 'memory' },
  { id: 'settings-profiles', label: 'Settings Profiles', group: 'profiles' },
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
  const groups: Array<{ id: DashboardTab['group']; label: string }> = [
    { id: 'general', label: 'General' },
    { id: 'tuning', label: 'Prompt Tuning' },
    { id: 'memory', label: 'Memory' },
    { id: 'profiles', label: 'Profiles' }
  ]

  const sections = groups
    .map((group) => {
      const buttons = DASHBOARD_TABS
        .filter((tab) => tab.group === group.id)
        .map((tab) => {
          const activeClass = tab.id === activeTab ? ' da-sidebar-btn--active' : ''
          return `<button class="da-sidebar-btn${activeClass}" data-da-target="${tab.id}"><span>${tab.label}</span><span aria-hidden="true">›</span></button>`
        })
        .join('\n')

      return `<section class="da-nav-group"><div class="da-nav-group-label">${group.label}</div>${buttons}</section>`
    })
    .join('\n')

  return `
    <aside class="da-sidebar">
      <div class="da-sidebar-header">
        <div class="da-kicker">Director Actor</div>
        <h1 class="da-title">Director Dashboard</h1>
        <p class="da-subtitle">Fullscreen control center for settings, models, prompts, memory, and profiles.</p>
      </div>
      <nav class="da-sidebar-nav">${sections}</nav>
      <div class="da-sidebar-footer da-footer">
        <button class="da-btn da-btn--ghost" data-da-action="export-settings">Export Settings</button>
        <button class="da-btn da-btn--danger da-close-btn" data-da-action="close-dashboard">Close</button>
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
              <h3 class="da-card-title">Plugin Status</h3>
              <p class="da-card-copy">Enable the director, tune tone strictness, and keep a quick view of connection health.</p>
            </div>
            <span class="da-badge" data-kind="${connectionStatus.kind === 'error' ? 'error' : connectionStatus.kind === 'success' ? 'success' : 'neutral'}">${connectionStatus.kind}</span>
          </div>
          <label class="da-toggle">
            <input type="checkbox" data-da-field="enabled"${settings.enabled ? ' checked' : ''} />
            <span class="da-toggle-track"><span class="da-toggle-dot"></span></span>
            <span>Enabled</span>
          </label>
          <label class="da-label">
            <span class="da-label-text">Assertiveness</span>
            <select class="da-select" data-da-field="assertiveness">
            <option value="light"${settings.assertiveness === 'light' ? ' selected' : ''}>Light</option>
            <option value="standard"${settings.assertiveness === 'standard' ? ' selected' : ''}>Standard</option>
            <option value="firm"${settings.assertiveness === 'firm' ? ' selected' : ''}>Firm</option>
            </select>
          </label>
          <div class="da-inline">
            <label class="da-label">
              <span class="da-label-text">Mode</span>
              <select class="da-select" data-da-field="directorMode">
                <option value="otherAx"${settings.directorMode === 'otherAx' ? ' selected' : ''}>Risu Aux Model</option>
                <option value="model"${settings.directorMode === 'model' ? ' selected' : ''}>Independent Provider</option>
              </select>
            </label>
            <label class="da-label">
              <span class="da-label-text">Injection Mode</span>
              <select class="da-select" data-da-field="injectionMode">
                <option value="auto"${settings.injectionMode === 'auto' ? ' selected' : ''}>Auto</option>
                <option value="author-note"${settings.injectionMode === 'author-note' ? ' selected' : ''}>Author Note</option>
                <option value="adjacent-user"${settings.injectionMode === 'adjacent-user' ? ' selected' : ''}>Adjacent User</option>
                <option value="post-constraint"${settings.injectionMode === 'post-constraint' ? ' selected' : ''}>Post Constraint</option>
                <option value="bottom"${settings.injectionMode === 'bottom' ? ' selected' : ''}>Bottom</option>
              </select>
            </label>
          </div>
          <span class="da-connection-status" data-da-status="${connectionStatus.kind}">${connectionStatus.message}</span>
        </section>
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">Metrics Snapshot</h3>
              <p class="da-card-copy">Quick read-only visibility into runtime behavior before you dive deeper.</p>
            </div>
          </div>
          <ul class="da-metric-list">
            <li class="da-metric-item"><span>Total Director Calls</span><strong>${input.pluginState.metrics.totalDirectorCalls}</strong></li>
            <li class="da-metric-item"><span>Total Failures</span><strong>${input.pluginState.metrics.totalDirectorFailures}</strong></li>
            <li class="da-metric-item"><span>Memory Writes</span><strong>${input.pluginState.metrics.totalMemoryWrites}</strong></li>
            <li class="da-metric-item"><span>Scene Phase</span><strong>${input.pluginState.director.scenePhase}</strong></li>
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
              <h3 class="da-card-title">Prompt Tuning</h3>
              <p class="da-card-copy">Tune how strongly the Director pushes, how large the brief is, and whether post-review stays active.</p>
            </div>
          </div>
          <div class="da-form-grid">
            <label class="da-label">
              <span class="da-label-text">Brief Token Cap</span>
              <input type="number" class="da-input" data-da-field="briefTokenCap" value="${settings.briefTokenCap}" />
            </label>
            <label class="da-toggle">
              <input type="checkbox" data-da-field="postReviewEnabled"${settings.postReviewEnabled ? ' checked' : ''} />
              <span class="da-toggle-track"><span class="da-toggle-dot"></span></span>
              <span>Enable Post-review</span>
            </label>
            <label class="da-toggle">
              <input type="checkbox" data-da-field="embeddingsEnabled"${settings.embeddingsEnabled ? ' checked' : ''} />
              <span class="da-toggle-track"><span class="da-toggle-dot"></span></span>
              <span>Enable Embeddings</span>
            </label>
          </div>
        </section>
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">Timing & Limits</h3>
              <p class="da-card-copy">Cooldown and debounce controls keep the Director stable under streaming and bad responses.</p>
            </div>
          </div>
          <div class="da-form-grid">
            <label class="da-label">
              <span class="da-label-text">Cooldown Failures</span>
              <input type="number" class="da-input" data-da-field="cooldownFailureThreshold" value="${settings.cooldownFailureThreshold}" />
            </label>
            <label class="da-label">
              <span class="da-label-text">Cooldown (ms)</span>
              <input type="number" class="da-input" data-da-field="cooldownMs" value="${settings.cooldownMs}" />
            </label>
            <label class="da-label">
              <span class="da-label-text">Output Debounce (ms)</span>
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
              <h3 class="da-card-title">Director Model Settings</h3>
              <p class="da-card-copy">Keep the Director on its own provider, base URL, key, and model without touching the main RP model.</p>
            </div>
          </div>
          <div class="da-form-grid">
            <label class="da-label">
              <span class="da-label-text">Provider</span>
              <select class="da-select" data-da-field="directorProvider">
                <option value="openai"${settings.directorProvider === 'openai' ? ' selected' : ''}>OpenAI</option>
                <option value="anthropic"${settings.directorProvider === 'anthropic' ? ' selected' : ''}>Anthropic</option>
                <option value="google"${settings.directorProvider === 'google' ? ' selected' : ''}>Google</option>
                <option value="custom"${settings.directorProvider === 'custom' ? ' selected' : ''}>Custom</option>
              </select>
            </label>
            <div class="da-split">
              <label class="da-label">
                <span class="da-label-text">Base URL</span>
                <input type="text" class="da-input" data-da-field="directorBaseUrl" value="${settings.directorBaseUrl}" />
              </label>
              <label class="da-label">
                <span class="da-label-text">API Key</span>
                <input type="password" class="da-input" data-da-field="directorApiKey" value="${settings.directorApiKey}" />
              </label>
            </div>
            <label class="da-label">
              <span class="da-label-text">Model</span>
              <select class="da-select" data-da-field="directorModel">${modelOptionEls}</select>
            </label>
            <label class="da-label">
              <span class="da-label-text">Custom Model ID</span>
              <input type="text" class="da-input" data-da-field="directorModel" value="${settings.directorModel}" placeholder="type a model ID directly" />
            </label>
            <div class="da-inline">
              <button class="da-btn da-btn--primary" data-da-action="test-connection">Test Connection</button>
              <button class="da-btn" data-da-action="refresh-models">Refresh Models</button>
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
              <h3 class="da-card-title">Memory & Cache</h3>
              <p class="da-card-copy">Inspect the long-memory substrate and keep an eye on the cache/memory write behavior.</p>
            </div>
          </div>
          <p class="da-hint">Memory summaries, entity graphs, and cache controls will appear here.</p>
        </section>
      </div>`
}

function buildSettingsProfilesPage(input: DashboardMarkupInput): string {
  const { profiles } = input
  const profileItems = profiles.profiles
    .map((p) => {
      const active = p.id === profiles.activeProfileId ? ' da-profile--active' : ''
      return `<li class="da-profile-item${active}" data-da-profile-id="${p.id}">${p.name}</li>`
    })
    .join('')
  return `
      <div class="da-grid">
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">Settings Profiles</h3>
              <p class="da-card-copy">Save reusable presets, swap them in one click, and move them between saves with JSON import/export.</p>
            </div>
          </div>
          <ul class="da-profile-list">${profileItems}</ul>
          <div class="da-inline">
            <button class="da-btn da-btn--primary" data-da-action="create-profile">New Profile</button>
            <button class="da-btn" data-da-action="export-profile">Export</button>
            <button class="da-btn" data-da-action="import-profile">Import</button>
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
      <h2 class="da-page-title">${tab.label}</h2>${inner}
    </div>`
  }).join('')

  return `
    <main class="da-content">
      <section class="da-toolbar">
        <div class="da-toolbar-meta">
          <div class="da-kicker">Cupcake-style dashboard</div>
          <strong>Modern control surface for Director behavior, models, and memory.</strong>
        </div>
        <div class="da-toolbar-actions">
          <span class="da-dirty-indicator">Unsaved changes stay local until you save.</span>
          <button class="da-btn da-btn--primary" data-da-action="save-settings">Save Changes</button>
          <button class="da-btn" data-da-action="reset-settings">Reset</button>
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
