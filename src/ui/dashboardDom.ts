import type { DirectorSettings, DirectorPluginState } from '../contracts/types.js'
import type { ProfileManifest, MemoryOpsStatus } from './dashboardState.js'
import { DASHBOARD_ROOT_CLASS } from './dashboardCss.js'
import { EMBEDDING_PROVIDER_CATALOG } from './dashboardModel.js'
import { resolveSelectedPromptPreset } from './dashboardState.js'
import { BUILTIN_PROMPT_PRESET_ID } from '../director/prompt.js'
import {
  t,
  tabLabel,
  sidebarGroupLabel,
  profileDisplayName,
  embeddingProviderLabel,
  getLocale,
} from './i18n.js'
import type { DashboardLocale } from './i18n.js'
import { escapeXml } from '../utils/xml.js'

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

export interface DashboardTab {
  id: string
  group: 'general' | 'tuning' | 'memory' | 'profiles'
}

export const DASHBOARD_TABS: readonly DashboardTab[] = [
  { id: 'general', group: 'general' },
  { id: 'prompt-tuning', group: 'tuning' },
  { id: 'model-settings', group: 'tuning' },
  { id: 'memory-cache', group: 'memory' },
  { id: 'settings-profiles', group: 'profiles' },
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
  selectedMemoryKeys?: string[]
  editingMemory?: {
    kind: 'summary' | 'continuity-fact' | 'world-fact' | 'entity' | 'relation'
    id: string
  } | null
  memoryOpsStatus?: MemoryOpsStatus
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
  const selectedPreset = resolveSelectedPromptPreset(settings)
  const selectedPresetId = settings.promptPresets[settings.promptPresetId]
    ? settings.promptPresetId
    : BUILTIN_PROMPT_PRESET_ID
  const isBuiltinPreset = selectedPresetId === BUILTIN_PROMPT_PRESET_ID
  const presetDisabled = isBuiltinPreset ? ' disabled' : ''
  const promptPresetOptions = [
    `<option value="${BUILTIN_PROMPT_PRESET_ID}"${selectedPresetId === BUILTIN_PROMPT_PRESET_ID ? ' selected' : ''}>${t('promptPreset.defaultName')}</option>`,
    ...Object.values(settings.promptPresets)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(
        (preset) =>
          `<option value="${escapeXml(preset.id)}"${preset.id === selectedPresetId ? ' selected' : ''}>${escapeXml(preset.name)}</option>`,
      ),
  ].join('')

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
              <h3 class="da-card-title">${t('card.promptPresets.title')}</h3>
              <p class="da-card-copy">${t('card.promptPresets.copy')}</p>
            </div>
          </div>
          <div class="da-form-grid">
            <label class="da-label">
              <span class="da-label-text">${t('label.promptPreset')}</span>
              <select class="da-select" data-da-role="prompt-preset-select">${promptPresetOptions}</select>
            </label>
            <div class="da-inline">
              <button class="da-btn da-btn--primary" data-da-action="create-prompt-preset">${t('btn.newPromptPreset')}</button>
              <button class="da-btn da-btn--danger" data-da-action="delete-prompt-preset"${isBuiltinPreset ? ' disabled' : ''}>${t('btn.deletePromptPreset')}</button>
            </div>
            ${isBuiltinPreset ? `<p class="da-hint">${t('promptPreset.readOnlyHint')}</p>` : ''}
            <label class="da-label">
              <span class="da-label-text">${t('label.promptPresetName')}</span>
              <input type="text" class="da-input" data-da-role="prompt-preset-name" value="${escapeXml(isBuiltinPreset ? t('promptPreset.defaultName') : selectedPreset.name)}"${presetDisabled} />
            </label>
            <label class="da-label">
              <span class="da-label-text">${t('label.preRequestSystemTemplate')}</span>
              <textarea class="da-textarea" data-da-role="prompt-pre-request-system"${presetDisabled}>${escapeXml(selectedPreset.preset.preRequestSystemTemplate)}</textarea>
            </label>
            <label class="da-label">
              <span class="da-label-text">${t('label.preRequestUserTemplate')}</span>
              <textarea class="da-textarea" data-da-role="prompt-pre-request-user"${presetDisabled}>${escapeXml(selectedPreset.preset.preRequestUserTemplate)}</textarea>
            </label>
            <label class="da-label">
              <span class="da-label-text">${t('label.postResponseSystemTemplate')}</span>
              <textarea class="da-textarea" data-da-role="prompt-post-response-system"${presetDisabled}>${escapeXml(selectedPreset.preset.postResponseSystemTemplate)}</textarea>
            </label>
            <label class="da-label">
              <span class="da-label-text">${t('label.postResponseUserTemplate')}</span>
              <textarea class="da-textarea" data-da-role="prompt-post-response-user"${presetDisabled}>${escapeXml(selectedPreset.preset.postResponseUserTemplate)}</textarea>
            </label>
            <label class="da-label">
              <span class="da-label-text">${t('label.maxRecentMessages')}</span>
              <input type="number" class="da-input" data-da-role="prompt-max-recent-messages" value="${selectedPreset.preset.maxRecentMessages}"${presetDisabled} />
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
    .map(
      (m) =>
        `<option value="${escapeXml(m)}"${m === settings.directorModel ? ' selected' : ''}>${escapeXml(m)}</option>`,
    )
    .join('')
  const embeddingProviderOptionEls = EMBEDDING_PROVIDER_CATALOG
    .map(
      (entry) =>
        `<option value="${entry.id}"${settings.embeddingProvider === entry.id ? ' selected' : ''}>${embeddingProviderLabel(entry.id)}</option>`
    )
    .join('')

  const embeddingSection = `
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t('card.embeddingSettings.title')}</h3>
              <p class="da-card-copy">${t('card.embeddingSettings.copy')}</p>
            </div>
          </div>
          <div class="da-form-grid">
            <label class="da-label">
              <span class="da-label-text">${t('label.embeddingProvider')}</span>
              <select class="da-select" data-da-field="embeddingProvider">${embeddingProviderOptionEls}</select>
            </label>
            <label class="da-label">
              <span class="da-label-text">${t('label.embeddingBaseUrl')}</span>
              <input type="text" class="da-input" data-da-field="embeddingBaseUrl" value="${escapeXml(settings.embeddingBaseUrl)}" />
            </label>
            <label class="da-label">
              <span class="da-label-text">${t('label.embeddingApiKey')}</span>
              <input type="password" class="da-input" data-da-field="embeddingApiKey" value="${escapeXml(settings.embeddingApiKey)}" />
            </label>
            <label class="da-label">
              <span class="da-label-text">${t('label.embeddingModel')}</span>
              <input type="text" class="da-input" data-da-field="embeddingModel" value="${escapeXml(settings.embeddingModel)}" />
            </label>
            <label class="da-label">
              <span class="da-label-text">${t('label.embeddingDimensions')}</span>
              <input type="number" class="da-input" data-da-field="embeddingDimensions" value="${settings.embeddingDimensions}" />
            </label>
          </div>
        </section>`

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
                <option value="copilot"${settings.directorProvider === 'copilot' ? ' selected' : ''}>${t('option.copilot')}</option>
                <option value="vertex"${settings.directorProvider === 'vertex' ? ' selected' : ''}>${t('option.vertex')}</option>
                <option value="custom"${settings.directorProvider === 'custom' ? ' selected' : ''}>${t('option.custom')}</option>
              </select>
            </label>
            <div class="da-split">
              <label class="da-label">
                <span class="da-label-text">${t('label.baseUrl')}</span>
                <input type="text" class="da-input" data-da-field="directorBaseUrl" value="${escapeXml(settings.directorBaseUrl)}" />
              </label>
              <label class="da-label">
                <span class="da-label-text">${t('label.apiKey')}</span>
                <input type="password" class="da-input" data-da-field="directorApiKey" value="${escapeXml(settings.directorApiKey)}" />
              </label>
            </div>
            <label class="da-label">
              <span class="da-label-text">${t('label.model')}</span>
              <select class="da-select" data-da-field="directorModel">${modelOptionEls}</select>
            </label>
            <label class="da-label">
              <span class="da-label-text">${t('label.customModelId')}</span>
              <input type="text" class="da-input" data-da-field="directorModel" value="${escapeXml(settings.directorModel)}" placeholder="${t('placeholder.customModelId')}" />
            </label>
            <div class="da-inline">
              <button class="da-btn da-btn--primary" data-da-action="test-connection">${t('btn.testConnection')}</button>
              <button class="da-btn" data-da-action="refresh-models">${t('btn.refreshModels')}</button>
            </div>
          </div>
        </section>${embeddingSection}
      </div>`
}

// ---------------------------------------------------------------------------
// Memory operations status card
// ---------------------------------------------------------------------------

function formatTimestamp(ts: number): string {
  if (ts === 0) return t('memoryOps.neverRun')
  return new Date(ts).toLocaleString()
}

function freshnessLabel(freshness: 'current' | 'stale' | 'unknown'): string {
  switch (freshness) {
    case 'current': return t('memoryOps.freshnessCurrent')
    case 'stale': return t('memoryOps.freshnessStale')
    default: return t('memoryOps.freshnessUnknown')
  }
}

function buildMemoryOpsCard(status: MemoryOpsStatus): string {
  const { documentCounts: dc } = status
  const freshnessBadge = `<span class="da-badge" data-kind="${status.notebookFreshness === 'stale' ? 'error' : status.notebookFreshness === 'current' ? 'success' : 'neutral'}">${freshnessLabel(status.notebookFreshness)}</span>`

  const lockedHtml = status.isMemoryLocked
    ? `<div class="da-warning" data-da-role="memory-locked"><span class="da-badge" data-kind="error">${escapeXml(t('memoryOps.locked'))}</span></div>`
    : ''

  const staleHtml = status.staleWarnings.length > 0
    ? `<div class="da-warning-list" data-da-role="stale-warnings">${status.staleWarnings.map((w) => `<div class="da-warning-item">${escapeXml(w)}</div>`).join('')}</div>`
    : ''

  const fallbackLabel = status.fallbackRetrievalEnabled
    ? t('memoryOps.fallbackEnabled')
    : t('memoryOps.fallbackDisabled')

  const recalledHtml = status.recalledDocs.length > 0
    ? `<ul class="da-recalled-list" data-da-role="recalled-docs">${status.recalledDocs.map((d) => {
      const badge = d.freshness !== 'current'
        ? ` <span class="da-badge da-badge--sm" data-kind="${d.freshness === 'stale' ? 'error' : 'neutral'}">${escapeXml(d.freshness)}</span>`
        : ''
      return `<li class="da-recalled-item">${escapeXml(d.title)}${badge}</li>`
    }).join('')}</ul>`
    : ''

  const diagHtml = buildDiagnosticsSection(status)

  return `
        <section class="da-card" data-da-role="memory-ops-status">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t('card.memoryOps.title')}</h3>
              <p class="da-card-copy">${t('card.memoryOps.copy')}</p>
            </div>
            ${freshnessBadge}
          </div>
          ${lockedHtml}${staleHtml}
          <ul class="da-metric-list">
            <li class="da-metric-item"><span>${t('memoryOps.lastExtract')}</span><strong>${formatTimestamp(status.lastExtractTs)}</strong></li>
            <li class="da-metric-item"><span>${t('memoryOps.lastDream')}</span><strong>${formatTimestamp(status.lastDreamTs)}</strong></li>
            <li class="da-metric-item"><span>${t('memoryOps.docCounts')}</span><strong>${t('card.memorySummaries.title')}: ${dc.summaries} · ${t('card.continuityFacts.title')}: ${dc.continuityFacts} · ${t('card.worldFacts.title')}: ${dc.worldFacts} · ${t('card.entities.title')}: ${dc.entities} · ${t('card.relations.title')}: ${dc.relations}</strong></li>
            <li class="da-metric-item"><span>${fallbackLabel}</span></li>
          </ul>
          <div class="da-inline">
            <button class="da-btn da-btn--primary da-btn--sm" data-da-action="force-extract">${t('btn.forceExtract')}</button>
            <button class="da-btn da-btn--sm" data-da-action="force-dream">${t('btn.forceDream')}</button>
            <button class="da-btn da-btn--sm" data-da-action="inspect-recalled">${t('btn.inspectRecalled')}</button>
            <button class="da-btn da-btn--sm" data-da-action="toggle-fallback-retrieval">${t('btn.toggleFallback')}</button>
          </div>
          ${recalledHtml}
          ${diagHtml}
        </section>`
}

// ---------------------------------------------------------------------------
// Diagnostics subsection (rendered inside memory ops card)
// ---------------------------------------------------------------------------

function healthBadgeKind(health: 'idle' | 'ok' | 'error'): string {
  switch (health) {
    case 'ok': return 'success'
    case 'error': return 'error'
    default: return 'neutral'
  }
}

function healthLabel(health: 'idle' | 'ok' | 'error'): string {
  switch (health) {
    case 'ok': return t('diag.health.ok')
    case 'error': return t('diag.health.error')
    default: return t('diag.health.idle')
  }
}

function buildDiagnosticsSection(status: MemoryOpsStatus): string {
  const diag = status.diagnostics
  if (!diag) return ''

  const lastHookLabel = diag.lastHookKind
    ? `${diag.lastHookKind} @ ${formatTimestamp(diag.lastHookTs)}`
    : t('memoryOps.neverRun')

  const lastErrorLabel = diag.lastErrorMessage
    ? `${escapeXml(diag.lastErrorMessage)} @ ${formatTimestamp(diag.lastErrorTs)}`
    : t('diag.noError')

  const workerRows = (['extraction', 'dream', 'recovery'] as const).map((kind) => {
    const ws = diag[kind]
    const labelKey = kind === 'extraction' ? 'diag.extraction'
      : kind === 'dream' ? 'diag.dream'
      : 'diag.recovery'
    const badge = `<span class="da-badge da-badge--sm" data-kind="${healthBadgeKind(ws.health)}">${healthLabel(ws.health)}</span>`
    const ts = ws.lastTs > 0 ? formatTimestamp(ws.lastTs) : ''
    const detail = ws.lastDetail ? ` — ${escapeXml(ws.lastDetail)}` : ''
    return `<li class="da-metric-item" data-da-role="diag-worker-${kind}"><span>${t(labelKey)}</span><strong>${badge} ${ts}${detail}</strong></li>`
  }).join('')

  const breadcrumbsHtml = diag.breadcrumbs.length > 0
    ? `<ul class="da-breadcrumb-list" data-da-role="diag-breadcrumbs">${diag.breadcrumbs.slice().reverse().map((b) => {
      const detail = b.detail ? ` — ${escapeXml(b.detail)}` : ''
      return `<li class="da-breadcrumb-item">${formatTimestamp(b.ts)} <strong>${escapeXml(b.label)}</strong>${detail}</li>`
    }).join('')}</ul>`
    : `<p class="da-empty">${t('diag.noBreadcrumbs')}</p>`

  return `
          <div class="da-diag-section" data-da-role="diagnostics">
            <h4 class="da-card-title">${t('diag.title')}</h4>
            <ul class="da-metric-list">
              <li class="da-metric-item" data-da-role="diag-last-hook"><span>${t('diag.lastHook')}</span><strong>${lastHookLabel}</strong></li>
              <li class="da-metric-item" data-da-role="diag-last-error"><span>${t('diag.lastError')}</span><strong>${lastErrorLabel}</strong></li>
              ${workerRows}
            </ul>
            <h4 class="da-card-title">${t('diag.breadcrumbs')}</h4>
            ${breadcrumbsHtml}
          </div>`
}

// ---------------------------------------------------------------------------
// Memory cache page
// ---------------------------------------------------------------------------

function buildMemoryCachePage(input: DashboardMarkupInput): string {
  const { pluginState } = input
  const summaries = pluginState.memory.summaries
  const facts = pluginState.memory.continuityFacts
  const worldFacts = pluginState.memory.worldFacts
  const entities = pluginState.memory.entities
  const relations = pluginState.memory.relations
  const selectedKeys = new Set(input.selectedMemoryKeys ?? [])
  const editingMemory = input.editingMemory ?? null
  const isEmpty = summaries.length === 0 && facts.length === 0 && worldFacts.length === 0 && entities.length === 0 && relations.length === 0
  const selectedCount = selectedKeys.size

  const backfillHtml = `<div class="da-inline"><button class="da-btn da-btn--primary" data-da-action="backfill-current-chat">${t('btn.backfillCurrentChat')}</button></div>`
  const regenerateHtml = `<div class="da-inline"><button class="da-btn" data-da-action="regenerate-current-chat">${t('btn.regenerateCurrentChat')}</button></div>`
  const bulkDeleteHtml = `<div class="da-inline"><button class="da-btn da-btn--danger" data-da-action="bulk-delete-memory"${selectedCount === 0 ? ' disabled' : ''}>${t('btn.deleteSelected')}</button></div>`
  const filterHtml = `<input type="text" class="da-input" data-da-role="memory-filter" placeholder="${t('memory.filterPlaceholder')}" />`

  const addSummaryHtml = `<div class="da-add-row"><input type="text" class="da-input da-input--add" data-da-role="add-summary-text" placeholder="${t('memory.addSummaryPlaceholder')}" /><button class="da-btn da-btn--primary da-btn--sm" data-da-action="add-summary">${t('btn.add')}</button></div>`
  const addFactHtml = `<div class="da-add-row"><input type="text" class="da-input da-input--add" data-da-role="add-fact-text" placeholder="${t('memory.addFactPlaceholder')}" /><button class="da-btn da-btn--primary da-btn--sm" data-da-action="add-continuity-fact">${t('btn.add')}</button></div>`
  const addWorldFactHtml = `<div class="da-add-row"><input type="text" class="da-input da-input--add" data-da-role="add-world-fact-text" placeholder="${t('memory.addWorldFactPlaceholder')}" /><button class="da-btn da-btn--primary da-btn--sm" data-da-action="add-world-fact">${t('btn.add')}</button></div>`
  const addEntityHtml = `<div class="da-add-row"><input type="text" class="da-input da-input--add" data-da-role="add-entity-name" placeholder="${t('memory.addEntityNamePlaceholder')}" /><button class="da-btn da-btn--primary da-btn--sm" data-da-action="add-entity">${t('btn.add')}</button></div>`
  const addRelationHtml = `<div class="da-add-row"><input type="text" class="da-input da-input--add" data-da-role="add-relation-source" placeholder="${t('memory.addRelationSourcePlaceholder')}" /><input type="text" class="da-input da-input--add" data-da-role="add-relation-label" placeholder="${t('memory.addRelationLabelPlaceholder')}" /><input type="text" class="da-input da-input--add" data-da-role="add-relation-target" placeholder="${t('memory.addRelationTargetPlaceholder')}" /><button class="da-btn da-btn--primary da-btn--sm" data-da-action="add-relation">${t('btn.add')}</button></div>`

  function renderMemoryItem(
    kind: 'summary' | 'continuity-fact' | 'world-fact' | 'entity' | 'relation',
    id: string,
    displayText: string,
    deleteAction: string,
    editRole: string,
    editValue: string,
    extraEditFields = '',
  ): string {
    const itemKey = `${kind}:${id}`
    const checked = selectedKeys.has(itemKey) ? ' checked' : ''
    const isEditing = editingMemory?.kind === kind && editingMemory.id === id

    if (isEditing) {
      return `<li class="da-memory-item">
        <input type="checkbox" data-da-role="memory-select" data-da-item-key="${escapeXml(itemKey)}"${checked} />
        <div class="da-form-grid" style="flex:1">
          <input type="text" class="da-input" data-da-role="${editRole}" data-da-item-id="${escapeXml(id)}" value="${escapeXml(editValue)}" />
          ${extraEditFields}
        </div>
        <button class="da-btn da-btn--primary da-btn--sm" data-da-action="save-memory-edit" data-da-item-key="${escapeXml(itemKey)}">${t('btn.save')}</button>
        <button class="da-btn da-btn--sm" data-da-action="cancel-memory-edit" data-da-item-key="${escapeXml(itemKey)}">${t('btn.cancel')}</button>
      </li>`
    }

    return `<li class="da-memory-item">
      <input type="checkbox" data-da-role="memory-select" data-da-item-key="${escapeXml(itemKey)}"${checked} />
      <span>${escapeXml(displayText)}</span>
      <button class="da-btn da-btn--sm" data-da-action="edit-memory-item" data-da-item-key="${escapeXml(itemKey)}">${t('btn.edit')}</button>
      <button class="da-btn da-btn--danger da-btn--sm" data-da-action="${deleteAction}" data-da-item-id="${escapeXml(id)}">${t('btn.delete')}</button>
    </li>`
  }

  const summaryItems = summaries
    .map((s) =>
      renderMemoryItem(
        'summary',
        s.id,
        s.text,
        'delete-summary',
        'edit-summary-text',
        s.text,
      ),
    )
    .join('')

  const factItems = facts
    .map((f) =>
      renderMemoryItem(
        'continuity-fact',
        f.id,
        f.text,
        'delete-continuity-fact',
        'edit-continuity-fact-text',
        f.text,
      ),
    )
    .join('')

  const worldFactItems = worldFacts
    .map((w) =>
      renderMemoryItem(
        'world-fact',
        w.id,
        w.text,
        'delete-world-fact',
        'edit-world-fact-text',
        w.text,
      ),
    )
    .join('')

  const entityItems = entities
    .map((e) =>
      renderMemoryItem(
        'entity',
        e.id,
        e.name,
        'delete-entity',
        'edit-entity-name',
        e.name,
      ),
    )
    .join('')

  const relationItems = relations
    .map((r) =>
      renderMemoryItem(
        'relation',
        r.id,
        `${r.sourceId} → ${r.label} → ${r.targetId}`,
        'delete-relation',
        'edit-relation-source',
        r.sourceId,
        `<div class="da-inline">
          <input type="text" class="da-input" data-da-role="edit-relation-label" data-da-item-id="${escapeXml(r.id)}" value="${escapeXml(r.label)}" />
          <input type="text" class="da-input" data-da-role="edit-relation-target" data-da-item-id="${escapeXml(r.id)}" value="${escapeXml(r.targetId)}" />
        </div>`,
      ),
    )
    .join('')

  const emptyHintHtml = isEmpty
    ? `<p class="da-empty" data-da-role="memory-empty">${t('memory.emptyHint')}</p>`
    : ''

  const memoryOpsCardHtml = input.memoryOpsStatus
    ? buildMemoryOpsCard(input.memoryOpsStatus)
    : ''

  return `
      ${backfillHtml}${regenerateHtml}${bulkDeleteHtml}${filterHtml}${emptyHintHtml}
      ${memoryOpsCardHtml}
      <div class="da-grid">
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t('card.memorySummaries.title')}</h3>
            </div>
          </div>${summaryItems ? `\n          <ul class="da-memory-list">${summaryItems}</ul>` : ''}
          ${addSummaryHtml}
        </section>
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t('card.continuityFacts.title')}</h3>
            </div>
          </div>${factItems ? `\n          <ul class="da-memory-list">${factItems}</ul>` : ''}
          ${addFactHtml}
        </section>
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t('card.worldFacts.title')}</h3>
            </div>
          </div>${worldFactItems ? `\n          <ul class="da-memory-list">${worldFactItems}</ul>` : ''}
          ${addWorldFactHtml}
        </section>
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t('card.entities.title')}</h3>
            </div>
          </div>${entityItems ? `\n          <ul class="da-memory-list">${entityItems}</ul>` : ''}
          ${addEntityHtml}
        </section>
        <section class="da-card">
          <div class="da-card-header">
            <div>
              <h3 class="da-card-title">${t('card.relations.title')}</h3>
            </div>
          </div>${relationItems ? `\n          <ul class="da-memory-list">${relationItems}</ul>` : ''}
          ${addRelationHtml}
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
