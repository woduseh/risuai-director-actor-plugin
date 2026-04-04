import type { DirectorSettings, DirectorPluginState } from '../contracts/types.js'
import type { ProfileManifest, MemoryOpsStatus, EmbeddingCacheStatus } from './dashboardState.js'
import type { MemoryWorkbenchInput } from './memoryWorkbenchDom.js'
import { buildMemoryWorkbench } from './memoryWorkbenchDom.js'
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
  /** Current memory filter query to restore after rerender. */
  memoryFilterQuery?: string
  /** Scope label for the active scoped storage key. */
  scopeLabel?: string
  /** Read-only memory workbench input. */
  workbenchInput?: MemoryWorkbenchInput
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
          const activeClass = tab.id === activeTab ? ' cd-sidebar-btn--active' : ''
          return `<button class="cd-sidebar-btn${activeClass}" data-cd-target="${tab.id}"><span>${tabLabel(tab.id)}</span><span aria-hidden="true">›</span></button>`
        })
        .join('\n')

      return `<section class="cd-nav-group"><div class="cd-nav-group-label">${sidebarGroupLabel(group.id)}</div>${buttons}</section>`
    })
    .join('\n')

  const currentLocale = getLocale()
  const nextLocale: DashboardLocale = currentLocale === 'en' ? 'ko' : 'en'
  const nextLabel = currentLocale === 'en' ? t('lang.ko') : t('lang.en')

  return `
    <aside class="cd-sidebar">
      <div class="cd-sidebar-header">
        <div class="cd-kicker">${t('sidebar.kicker')}</div>
        <h1 class="cd-title">${t('sidebar.title')}</h1>
        <p class="cd-subtitle">${t('sidebar.subtitle')}</p>
      </div>
      <nav class="cd-sidebar-nav">${sections}</nav>
      <div class="cd-sidebar-footer cd-footer">
        <button class="cd-btn" data-cd-action="switch-lang" data-cd-lang="${nextLocale}">${nextLabel}</button>
        <button class="cd-btn cd-btn--ghost" data-cd-action="export-settings">${t('btn.exportSettings')}</button>
        <button class="cd-btn cd-btn--danger cd-close-btn" data-cd-action="close-dashboard" aria-label="${t('btn.close')}">${t('btn.close')}</button>
      </div>
    </aside>`
}

// ---------------------------------------------------------------------------
// Page shells
// ---------------------------------------------------------------------------

function buildGeneralPage(input: DashboardMarkupInput): string {
  const { settings, connectionStatus } = input
  return `
      <div class="cd-grid">
        <section class="cd-card">
          <div class="cd-card-header">
            <div>
              <h3 class="cd-card-title">${t('card.pluginStatus.title')}</h3>
              <p class="cd-card-copy">${t('card.pluginStatus.copy')}</p>
            </div>
            <span class="cd-badge" data-kind="${connectionStatus.kind === 'error' ? 'error' : connectionStatus.kind === 'success' ? 'success' : 'neutral'}">${connectionStatus.kind}</span>
          </div>
          <label class="cd-toggle">
            <input type="checkbox" data-cd-field="enabled"${settings.enabled ? ' checked' : ''} />
            <span class="cd-toggle-track"><span class="cd-toggle-dot"></span></span>
            <span>${t('label.enabled')}</span>
          </label>
          <label class="cd-label">
            <span class="cd-label-text">${t('label.assertiveness')}</span>
            <select class="cd-select" data-cd-field="assertiveness">
            <option value="light"${settings.assertiveness === 'light' ? ' selected' : ''}>${t('option.light')}</option>
            <option value="standard"${settings.assertiveness === 'standard' ? ' selected' : ''}>${t('option.standard')}</option>
            <option value="firm"${settings.assertiveness === 'firm' ? ' selected' : ''}>${t('option.firm')}</option>
            </select>
          </label>
          <div class="cd-inline">
            <label class="cd-label">
              <span class="cd-label-text">${t('label.mode')}</span>
              <select class="cd-select" data-cd-field="directorMode">
                <option value="otherAx"${settings.directorMode === 'otherAx' ? ' selected' : ''}>${t('option.risuAux')}</option>
                <option value="model"${settings.directorMode === 'model' ? ' selected' : ''}>${t('option.independentProvider')}</option>
              </select>
            </label>
            <label class="cd-label">
              <span class="cd-label-text">${t('label.injectionMode')}</span>
              <select class="cd-select" data-cd-field="injectionMode">
                <option value="auto"${settings.injectionMode === 'auto' ? ' selected' : ''}>${t('option.auto')}</option>
                <option value="author-note"${settings.injectionMode === 'author-note' ? ' selected' : ''}>${t('option.authorNote')}</option>
                <option value="adjacent-user"${settings.injectionMode === 'adjacent-user' ? ' selected' : ''}>${t('option.adjacentUser')}</option>
                <option value="post-constraint"${settings.injectionMode === 'post-constraint' ? ' selected' : ''}>${t('option.postConstraint')}</option>
                <option value="bottom"${settings.injectionMode === 'bottom' ? ' selected' : ''}>${t('option.bottom')}</option>
              </select>
            </label>
          </div>
          <span class="cd-connection-status" data-cd-status="${connectionStatus.kind}" role="status" aria-live="polite">${connectionStatus.message}</span>
        </section>
        <section class="cd-card">
          <div class="cd-card-header">
            <div>
              <h3 class="cd-card-title">${t('card.metricsSnapshot.title')}</h3>
              <p class="cd-card-copy">${t('card.metricsSnapshot.copy')}</p>
            </div>
          </div>
          <ul class="cd-metric-list">
            <li class="cd-metric-item"><span>${t('metric.totalDirectorCalls')}</span><strong>${input.pluginState.metrics.totalDirectorCalls}</strong></li>
            <li class="cd-metric-item"><span>${t('metric.totalFailures')}</span><strong>${input.pluginState.metrics.totalDirectorFailures}</strong></li>
            <li class="cd-metric-item"><span>${t('metric.memoryWrites')}</span><strong>${input.pluginState.metrics.totalMemoryWrites}</strong></li>
            <li class="cd-metric-item"><span>${t('metric.scenePhase')}</span><strong>${input.pluginState.director.scenePhase}</strong></li>
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
      <div class="cd-grid">
        <section class="cd-card">
          <div class="cd-card-header">
            <div>
              <h3 class="cd-card-title">${t('card.promptTuning.title')}</h3>
              <p class="cd-card-copy">${t('card.promptTuning.copy')}</p>
            </div>
          </div>
          <div class="cd-form-grid">
            <label class="cd-label">
              <span class="cd-label-text">${t('label.briefTokenCap')}</span>
              <input type="number" class="cd-input" data-cd-field="briefTokenCap" value="${settings.briefTokenCap}" />
            </label>
            <label class="cd-toggle">
              <input type="checkbox" data-cd-field="postReviewEnabled"${settings.postReviewEnabled ? ' checked' : ''} />
              <span class="cd-toggle-track"><span class="cd-toggle-dot"></span></span>
              <span>${t('label.postReview')}</span>
            </label>
            <label class="cd-toggle">
              <input type="checkbox" data-cd-field="embeddingsEnabled"${settings.embeddingsEnabled ? ' checked' : ''} />
              <span class="cd-toggle-track"><span class="cd-toggle-dot"></span></span>
              <span>${t('label.embeddings')}</span>
            </label>
          </div>
        </section>
        <section class="cd-card">
          <div class="cd-card-header">
            <div>
              <h3 class="cd-card-title">${t('card.promptPresets.title')}</h3>
              <p class="cd-card-copy">${t('card.promptPresets.copy')}</p>
            </div>
          </div>
          <div class="cd-form-grid">
            <label class="cd-label">
              <span class="cd-label-text">${t('label.promptPreset')}</span>
              <select class="cd-select" data-cd-role="prompt-preset-select">${promptPresetOptions}</select>
            </label>
            <div class="cd-inline">
              <button class="cd-btn cd-btn--primary" data-cd-action="create-prompt-preset">${t('btn.newPromptPreset')}</button>
              <button class="cd-btn cd-btn--danger" data-cd-action="delete-prompt-preset"${isBuiltinPreset ? ' disabled' : ''}>${t('btn.deletePromptPreset')}</button>
            </div>
            ${isBuiltinPreset ? `<p class="cd-hint">${t('promptPreset.readOnlyHint')}</p>` : ''}
            <label class="cd-label">
              <span class="cd-label-text">${t('label.promptPresetName')}</span>
              <input type="text" class="cd-input" data-cd-role="prompt-preset-name" value="${escapeXml(isBuiltinPreset ? t('promptPreset.defaultName') : selectedPreset.name)}"${presetDisabled} />
            </label>
            <label class="cd-label">
              <span class="cd-label-text">${t('label.preRequestSystemTemplate')}</span>
              <textarea class="cd-textarea" data-cd-role="prompt-pre-request-system"${presetDisabled}>${escapeXml(selectedPreset.preset.preRequestSystemTemplate)}</textarea>
            </label>
            <label class="cd-label">
              <span class="cd-label-text">${t('label.preRequestUserTemplate')}</span>
              <textarea class="cd-textarea" data-cd-role="prompt-pre-request-user"${presetDisabled}>${escapeXml(selectedPreset.preset.preRequestUserTemplate)}</textarea>
            </label>
            <label class="cd-label">
              <span class="cd-label-text">${t('label.postResponseSystemTemplate')}</span>
              <textarea class="cd-textarea" data-cd-role="prompt-post-response-system"${presetDisabled}>${escapeXml(selectedPreset.preset.postResponseSystemTemplate)}</textarea>
            </label>
            <label class="cd-label">
              <span class="cd-label-text">${t('label.postResponseUserTemplate')}</span>
              <textarea class="cd-textarea" data-cd-role="prompt-post-response-user"${presetDisabled}>${escapeXml(selectedPreset.preset.postResponseUserTemplate)}</textarea>
            </label>
            <label class="cd-label">
              <span class="cd-label-text">${t('label.maxRecentMessages')}</span>
              <input type="number" class="cd-input" data-cd-role="prompt-max-recent-messages" value="${selectedPreset.preset.maxRecentMessages}"${presetDisabled} />
            </label>
          </div>
        </section>
        <section class="cd-card">
          <div class="cd-card-header">
            <div>
              <h3 class="cd-card-title">${t('card.timingLimits.title')}</h3>
              <p class="cd-card-copy">${t('card.timingLimits.copy')}</p>
            </div>
          </div>
          <div class="cd-form-grid">
            <label class="cd-label">
              <span class="cd-label-text">${t('label.cooldownFailures')}</span>
              <input type="number" class="cd-input" data-cd-field="cooldownFailureThreshold" value="${settings.cooldownFailureThreshold}" />
            </label>
            <label class="cd-label">
              <span class="cd-label-text">${t('label.cooldownMs')}</span>
              <input type="number" class="cd-input" data-cd-field="cooldownMs" value="${settings.cooldownMs}" />
            </label>
            <label class="cd-label">
              <span class="cd-label-text">${t('label.outputDebounceMs')}</span>
              <input type="number" class="cd-input" data-cd-field="outputDebounceMs" value="${settings.outputDebounceMs}" />
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
        <section class="cd-card">
          <div class="cd-card-header">
            <div>
              <h3 class="cd-card-title">${t('card.embeddingSettings.title')}</h3>
              <p class="cd-card-copy">${t('card.embeddingSettings.copy')}</p>
            </div>
          </div>
          <div class="cd-form-grid">
            <label class="cd-label">
              <span class="cd-label-text">${t('label.embeddingProvider')}</span>
              <select class="cd-select" data-cd-field="embeddingProvider">${embeddingProviderOptionEls}</select>
            </label>
            <label class="cd-label">
              <span class="cd-label-text">${t('label.embeddingBaseUrl')}</span>
              <input type="text" class="cd-input" data-cd-field="embeddingBaseUrl" value="${escapeXml(settings.embeddingBaseUrl)}" />
            </label>
            <label class="cd-label">
              <span class="cd-label-text">${t('label.embeddingApiKey')}</span>
              <input type="password" class="cd-input" data-cd-field="embeddingApiKey" value="${escapeXml(settings.embeddingApiKey)}" />
            </label>
            <label class="cd-label">
              <span class="cd-label-text">${t('label.embeddingModel')}</span>
              <input type="text" class="cd-input" data-cd-field="embeddingModel" value="${escapeXml(settings.embeddingModel)}" />
            </label>
            <label class="cd-label">
              <span class="cd-label-text">${t('label.embeddingDimensions')}</span>
              <input type="number" class="cd-input" data-cd-field="embeddingDimensions" value="${settings.embeddingDimensions}" />
            </label>
          </div>
        </section>`

  return `
      <div class="cd-grid">
        <section class="cd-card">
          <div class="cd-card-header">
            <div>
              <h3 class="cd-card-title">${t('card.directorModel.title')}</h3>
              <p class="cd-card-copy">${t('card.directorModel.copy')}</p>
            </div>
          </div>
          <div class="cd-form-grid">
            <label class="cd-label">
              <span class="cd-label-text">${t('label.provider')}</span>
              <select class="cd-select" data-cd-field="directorProvider">
                <option value="openai"${settings.directorProvider === 'openai' ? ' selected' : ''}>${t('option.openai')}</option>
                <option value="anthropic"${settings.directorProvider === 'anthropic' ? ' selected' : ''}>${t('option.anthropic')}</option>
                <option value="google"${settings.directorProvider === 'google' ? ' selected' : ''}>${t('option.google')}</option>
                <option value="copilot"${settings.directorProvider === 'copilot' ? ' selected' : ''}>${t('option.copilot')}</option>
                <option value="vertex"${settings.directorProvider === 'vertex' ? ' selected' : ''}>${t('option.vertex')}</option>
                <option value="custom"${settings.directorProvider === 'custom' ? ' selected' : ''}>${t('option.custom')}</option>
              </select>
            </label>
            <div class="cd-split">
              <label class="cd-label">
                <span class="cd-label-text">${t('label.baseUrl')}</span>
                <input type="text" class="cd-input" data-cd-field="directorBaseUrl" value="${escapeXml(settings.directorBaseUrl)}" />
              </label>
              <label class="cd-label">
                <span class="cd-label-text">${t('label.apiKey')}</span>
                <input type="password" class="cd-input" data-cd-field="directorApiKey" value="${escapeXml(settings.directorApiKey)}" />
              </label>
            </div>
            <label class="cd-label">
              <span class="cd-label-text">${t('label.model')}</span>
              <select class="cd-select" data-cd-field="directorModel">${modelOptionEls}</select>
            </label>
            <label class="cd-label">
              <span class="cd-label-text">${t('label.customModelId')}</span>
              <input type="text" class="cd-input" data-cd-field="directorModel" value="${escapeXml(settings.directorModel)}" placeholder="${t('placeholder.customModelId')}" />
            </label>
            <div class="cd-inline">
              <button class="cd-btn cd-btn--primary" data-cd-action="test-connection">${t('btn.testConnection')}</button>
              <button class="cd-btn" data-cd-action="refresh-models">${t('btn.refreshModels')}</button>
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

// ---------------------------------------------------------------------------
// Embedding cache status section (rendered inside memory ops card)
// ---------------------------------------------------------------------------

function embeddingStatusBadgeKind(cache: EmbeddingCacheStatus): string {
  if (!cache.enabled) return 'neutral'
  if (!cache.supported) return 'error'
  if (cache.missingCount > 0 || cache.staleCount > 0) return 'error'
  if (cache.readyCount > 0) return 'success'
  return 'neutral'
}

function embeddingStatusLabel(cache: EmbeddingCacheStatus): string {
  if (!cache.enabled) return t('embeddingStatus.disabled')
  if (!cache.supported) return t('embeddingStatus.unsupported')
  if (cache.readyCount > 0 && cache.staleCount === 0 && cache.missingCount === 0) {
    return t('embeddingStatus.ready')
  }
  if (cache.staleCount > 0) return t('embeddingStatus.stale')
  if (cache.missingCount > 0) return t('embeddingStatus.missing')
  return t('embeddingStatus.disabled')
}

function buildEmbeddingStatusSection(cache: EmbeddingCacheStatus): string {
  const badge = `<span class="cd-badge cd-badge--sm" data-kind="${embeddingStatusBadgeKind(cache)}">${embeddingStatusLabel(cache)}</span>`
  const countsLabel = `${t('embeddingStatus.ready')}: ${cache.readyCount} · ${t('embeddingStatus.stale')}: ${cache.staleCount} · ${t('embeddingStatus.missing')}: ${cache.missingCount}`
  const versionLabel = cache.currentVersion || '—'

  return `
          <div class="cd-embedding-status" data-cd-role="embedding-status">
            <h4 class="cd-card-title">${t('embeddingStatus.title')} ${badge}</h4>
            <ul class="cd-metric-list">
              <li class="cd-metric-item"><span>${t('embeddingStatus.counts')}</span><strong>${countsLabel}</strong></li>
              <li class="cd-metric-item"><span>${t('embeddingStatus.version')}</span><strong>${escapeXml(versionLabel)}</strong></li>
            </ul>
          </div>`
}

// ---------------------------------------------------------------------------
// Memory operations status card
// ---------------------------------------------------------------------------

function buildMemoryOpsCard(status: MemoryOpsStatus): string {
  const { documentCounts: dc } = status
  const freshnessBadge = `<span class="cd-badge" data-kind="${status.notebookFreshness === 'stale' ? 'error' : status.notebookFreshness === 'current' ? 'success' : 'neutral'}">${freshnessLabel(status.notebookFreshness)}</span>`

  const lockedHtml = status.isMemoryLocked
    ? `<div class="cd-warning" data-cd-role="memory-locked"><span class="cd-badge" data-kind="error">${escapeXml(t('memoryOps.locked'))}</span></div>`
    : ''

  const staleHtml = status.staleWarnings.length > 0
    ? `<div class="cd-warning-list" data-cd-role="stale-warnings">${status.staleWarnings.map((w) => `<div class="cd-warning-item">${escapeXml(w)}</div>`).join('')}</div>`
    : ''

  const fallbackLabel = status.fallbackRetrievalEnabled
    ? t('memoryOps.fallbackEnabled')
    : t('memoryOps.fallbackDisabled')

  const recalledHtml = status.recalledDocs.length > 0
    ? `<ul class="cd-recalled-list" data-cd-role="recalled-docs">${status.recalledDocs.map((d) => {
      const badge = d.freshness !== 'current'
        ? ` <span class="cd-badge cd-badge--sm" data-kind="${d.freshness === 'stale' ? 'error' : 'neutral'}">${escapeXml(d.freshness)}</span>`
        : ''
      return `<li class="cd-recalled-item">${escapeXml(d.title)}${badge}</li>`
    }).join('')}</ul>`
    : ''

  const embeddingStatusHtml = buildEmbeddingStatusSection(status.embeddingCache)

  const diagHtml = buildDiagnosticsSection(status)

  return `
        <section class="cd-card" data-cd-role="memory-ops-status">
          <div class="cd-card-header">
            <div>
              <h3 class="cd-card-title">${t('card.memoryOps.title')}</h3>
              <p class="cd-card-copy">${t('card.memoryOps.copy')}</p>
            </div>
            ${freshnessBadge}
          </div>
          ${lockedHtml}${staleHtml}
          <ul class="cd-metric-list">
            <li class="cd-metric-item"><span>${t('memoryOps.lastExtract')}</span><strong>${formatTimestamp(status.lastExtractTs)}</strong></li>
            <li class="cd-metric-item"><span>${t('memoryOps.lastDream')}</span><strong>${formatTimestamp(status.lastDreamTs)}</strong></li>
            <li class="cd-metric-item"><span>${t('memoryOps.docCounts')}</span><strong>${t('card.memorySummaries.title')}: ${dc.summaries} · ${t('card.continuityFacts.title')}: ${dc.continuityFacts} · ${t('card.worldFacts.title')}: ${dc.worldFacts} · ${t('card.entities.title')}: ${dc.entities} · ${t('card.relations.title')}: ${dc.relations}</strong></li>
            <li class="cd-metric-item"><span>${fallbackLabel}</span></li>
          </ul>
          <div class="cd-inline">
            <button class="cd-btn cd-btn--primary cd-btn--sm" data-cd-action="force-extract">${t('btn.forceExtract')}</button>
            <button class="cd-btn cd-btn--sm" data-cd-action="force-dream">${t('btn.forceDream')}</button>
            <button class="cd-btn cd-btn--sm" data-cd-action="inspect-recalled">${t('btn.inspectRecalled')}</button>
            <button class="cd-btn cd-btn--sm" data-cd-action="toggle-fallback-retrieval">${t('btn.toggleFallback')}</button>
            <button class="cd-btn cd-btn--sm" data-cd-action="refresh-embeddings">${t('btn.refreshEmbeddings')}</button>
          </div>
          ${embeddingStatusHtml}
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
    const badge = `<span class="cd-badge cd-badge--sm" data-kind="${healthBadgeKind(ws.health)}">${healthLabel(ws.health)}</span>`
    const ts = ws.lastTs > 0 ? formatTimestamp(ws.lastTs) : ''
    const detail = ws.lastDetail ? ` — ${escapeXml(ws.lastDetail)}` : ''
    return `<li class="cd-metric-item" data-cd-role="diag-worker-${kind}"><span>${t(labelKey)}</span><strong>${badge} ${ts}${detail}</strong></li>`
  }).join('')

  const breadcrumbsHtml = diag.breadcrumbs.length > 0
    ? `<ul class="cd-breadcrumb-list" data-cd-role="diag-breadcrumbs">${diag.breadcrumbs.slice().reverse().map((b) => {
      const detail = b.detail ? ` — ${escapeXml(b.detail)}` : ''
      return `<li class="cd-breadcrumb-item">${formatTimestamp(b.ts)} <strong>${escapeXml(b.label)}</strong>${detail}</li>`
    }).join('')}</ul>`
    : `<p class="cd-empty">${t('diag.noBreadcrumbs')}</p>`

  return `
          <div class="cd-diag-section" data-cd-role="diagnostics">
            <h4 class="cd-card-title">${t('diag.title')}</h4>
            <ul class="cd-metric-list">
              <li class="cd-metric-item" data-cd-role="diag-last-hook"><span>${t('diag.lastHook')}</span><strong>${lastHookLabel}</strong></li>
              <li class="cd-metric-item" data-cd-role="diag-last-error"><span>${t('diag.lastError')}</span><strong>${lastErrorLabel}</strong></li>
              ${workerRows}
            </ul>
            <h4 class="cd-card-title">${t('diag.breadcrumbs')}</h4>
            ${breadcrumbsHtml}
          </div>`
}

// ---------------------------------------------------------------------------
// Memory cache page
// ---------------------------------------------------------------------------

export function buildMemoryCachePage(input: DashboardMarkupInput): string {
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

  const backfillHtml = `<div class="cd-inline"><button class="cd-btn cd-btn--primary" data-cd-action="backfill-current-chat">${t('btn.backfillCurrentChat')}</button></div>`
  const regenerateHtml = `<div class="cd-inline"><button class="cd-btn" data-cd-action="regenerate-current-chat">${t('btn.regenerateCurrentChat')}</button></div>`
  const bulkDeleteHtml = `<div class="cd-inline"><button class="cd-btn cd-btn--danger" data-cd-action="bulk-delete-memory"${selectedCount === 0 ? ' disabled' : ''}>${t('btn.deleteSelected')}</button></div>`
  const filterValue = input.memoryFilterQuery ? ` value="${escapeXml(input.memoryFilterQuery)}"` : ''
  const filterHtml = `<input type="text" class="cd-input" data-cd-role="memory-filter" placeholder="${t('memory.filterPlaceholder')}" aria-label="${t('memory.filterPlaceholder')}"${filterValue} />`

  // Scope badge
  const scopeText = input.scopeLabel ?? t('memory.scopeGlobal')
  const scopeBadgeHtml = `<span class="cd-badge" data-cd-role="scope-badge" data-kind="neutral">${escapeXml(t('memory.scopeLabel', { scope: scopeText }))}</span>`

  // Quick navigation
  const quickNavItems: Array<[string, string]> = [
    ['summaries', t('memory.quickNav.summaries')],
    ['continuity-facts', t('memory.quickNav.continuityFacts')],
    ['world-facts', t('memory.quickNav.worldFacts')],
    ['entities', t('memory.quickNav.entities')],
    ['relations', t('memory.quickNav.relations')],
  ]
  const quickNavHtml = `<nav class="cd-quick-nav" data-cd-role="memory-quick-nav">${quickNavItems.map(([target, label]) => `<button class="cd-btn cd-btn--sm" data-cd-nav-target="${target}">${escapeXml(label)}</button>`).join('')}</nav>`

  // Cross-link to model settings
  const crossLinkHtml = `<button class="cd-btn cd-btn--ghost" data-cd-role="model-settings-link" data-cd-target="model-settings">${t('memory.modelSettingsLink')}</button>`

  const addSummaryHtml = `<div class="cd-add-row"><input type="text" class="cd-input cd-input--add" data-cd-role="add-summary-text" placeholder="${t('memory.addSummaryPlaceholder')}" aria-label="${t('memory.addSummaryPlaceholder')}" /><button class="cd-btn cd-btn--primary cd-btn--sm" data-cd-action="add-summary">${t('btn.add')}</button></div>`
  const addFactHtml = `<div class="cd-add-row"><input type="text" class="cd-input cd-input--add" data-cd-role="add-fact-text" placeholder="${t('memory.addFactPlaceholder')}" aria-label="${t('memory.addFactPlaceholder')}" /><button class="cd-btn cd-btn--primary cd-btn--sm" data-cd-action="add-continuity-fact">${t('btn.add')}</button></div>`
  const addWorldFactHtml = `<div class="cd-add-row"><input type="text" class="cd-input cd-input--add" data-cd-role="add-world-fact-text" placeholder="${t('memory.addWorldFactPlaceholder')}" aria-label="${t('memory.addWorldFactPlaceholder')}" /><button class="cd-btn cd-btn--primary cd-btn--sm" data-cd-action="add-world-fact">${t('btn.add')}</button></div>`
  const addEntityHtml = `<div class="cd-add-row"><input type="text" class="cd-input cd-input--add" data-cd-role="add-entity-name" placeholder="${t('memory.addEntityNamePlaceholder')}" aria-label="${t('memory.addEntityNamePlaceholder')}" /><button class="cd-btn cd-btn--primary cd-btn--sm" data-cd-action="add-entity">${t('btn.add')}</button></div>`
  const addRelationHtml = `<div class="cd-add-row"><input type="text" class="cd-input cd-input--add" data-cd-role="add-relation-source" placeholder="${t('memory.addRelationSourcePlaceholder')}" aria-label="${t('memory.addRelationSourcePlaceholder')}" /><input type="text" class="cd-input cd-input--add" data-cd-role="add-relation-label" placeholder="${t('memory.addRelationLabelPlaceholder')}" aria-label="${t('memory.addRelationLabelPlaceholder')}" /><input type="text" class="cd-input cd-input--add" data-cd-role="add-relation-target" placeholder="${t('memory.addRelationTargetPlaceholder')}" aria-label="${t('memory.addRelationTargetPlaceholder')}" /><button class="cd-btn cd-btn--primary cd-btn--sm" data-cd-action="add-relation">${t('btn.add')}</button></div>`

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
    const selectLabel = `${t('btn.select')} ${displayText}`
    const editLabel = `${t('btn.edit')} ${displayText}`
    const deleteLabel = `${t('btn.delete')} ${displayText}`

    if (isEditing) {
      return `<li class="cd-memory-item">
        <input type="checkbox" data-cd-role="memory-select" data-cd-item-key="${escapeXml(itemKey)}"${checked} aria-label="${escapeXml(selectLabel)}" />
        <div class="cd-form-grid" style="flex:1">
          <input type="text" class="cd-input" data-cd-role="${editRole}" data-cd-item-id="${escapeXml(id)}" value="${escapeXml(editValue)}" />
          ${extraEditFields}
        </div>
        <button class="cd-btn cd-btn--primary cd-btn--sm" data-cd-action="save-memory-edit" data-cd-item-key="${escapeXml(itemKey)}">${t('btn.save')}</button>
        <button class="cd-btn cd-btn--sm" data-cd-action="cancel-memory-edit" data-cd-item-key="${escapeXml(itemKey)}">${t('btn.cancel')}</button>
      </li>`
    }

    return `<li class="cd-memory-item">
      <input type="checkbox" data-cd-role="memory-select" data-cd-item-key="${escapeXml(itemKey)}"${checked} aria-label="${escapeXml(selectLabel)}" />
      <span>${escapeXml(displayText)}</span>
      <button class="cd-btn cd-btn--sm" data-cd-action="edit-memory-item" data-cd-item-key="${escapeXml(itemKey)}" aria-label="${escapeXml(editLabel)}">${t('btn.edit')}</button>
      <button class="cd-btn cd-btn--danger cd-btn--sm" data-cd-action="${deleteAction}" data-cd-item-id="${escapeXml(id)}" aria-label="${escapeXml(deleteLabel)}">${t('btn.delete')}</button>
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
        `<div class="cd-inline">
          <input type="text" class="cd-input" data-cd-role="edit-relation-label" data-cd-item-id="${escapeXml(r.id)}" value="${escapeXml(r.label)}" />
          <input type="text" class="cd-input" data-cd-role="edit-relation-target" data-cd-item-id="${escapeXml(r.id)}" value="${escapeXml(r.targetId)}" />
        </div>`,
      ),
    )
    .join('')

  const emptyHintHtml = isEmpty
    ? `<p class="cd-empty" data-cd-role="memory-empty">${t('memory.emptyHint')}</p>`
    : ''

  const memoryOpsCardHtml = input.memoryOpsStatus
    ? buildMemoryOpsCard(input.memoryOpsStatus)
    : ''

  const workbenchHtml = input.workbenchInput
    ? buildMemoryWorkbench(input.workbenchInput)
    : ''

  return `
      ${scopeBadgeHtml}${quickNavHtml}
      ${backfillHtml}${regenerateHtml}${bulkDeleteHtml}${crossLinkHtml}${filterHtml}${emptyHintHtml}
      ${memoryOpsCardHtml}
      ${workbenchHtml}
      <div class="cd-grid">
        <section class="cd-card" id="cd-memory-section-summaries">
          <div class="cd-card-header">
            <div>
              <h3 class="cd-card-title">${t('card.memorySummaries.title')}</h3>
            </div>
          </div>${summaryItems ? `\n          <ul class="cd-memory-list">${summaryItems}</ul>` : ''}
          ${addSummaryHtml}
        </section>
        <section class="cd-card" id="cd-memory-section-continuity-facts">
          <div class="cd-card-header">
            <div>
              <h3 class="cd-card-title">${t('card.continuityFacts.title')}</h3>
            </div>
          </div>${factItems ? `\n          <ul class="cd-memory-list">${factItems}</ul>` : ''}
          ${addFactHtml}
        </section>
        <section class="cd-card" id="cd-memory-section-world-facts">
          <div class="cd-card-header">
            <div>
              <h3 class="cd-card-title">${t('card.worldFacts.title')}</h3>
            </div>
          </div>${worldFactItems ? `\n          <ul class="cd-memory-list">${worldFactItems}</ul>` : ''}
          ${addWorldFactHtml}
        </section>
        <section class="cd-card" id="cd-memory-section-entities">
          <div class="cd-card-header">
            <div>
              <h3 class="cd-card-title">${t('card.entities.title')}</h3>
            </div>
          </div>${entityItems ? `\n          <ul class="cd-memory-list">${entityItems}</ul>` : ''}
          ${addEntityHtml}
        </section>
        <section class="cd-card" id="cd-memory-section-relations">
          <div class="cd-card-header">
            <div>
              <h3 class="cd-card-title">${t('card.relations.title')}</h3>
            </div>
          </div>${relationItems ? `\n          <ul class="cd-memory-list">${relationItems}</ul>` : ''}
          ${addRelationHtml}
        </section>
      </div>`
}

function buildSettingsProfilesPage(input: DashboardMarkupInput): string {
  const { profiles } = input
  const profileItems = profiles.profiles
    .map((p) => {
      const active = p.id === profiles.activeProfileId ? ' cd-profile--active' : ''
      return `<li class="cd-profile-item${active}" data-cd-profile-id="${p.id}">${profileDisplayName(p.id, p.name)}</li>`
    })
    .join('')
  return `
      <div class="cd-grid">
        <section class="cd-card">
          <div class="cd-card-header">
            <div>
              <h3 class="cd-card-title">${t('card.settingsProfiles.title')}</h3>
              <p class="cd-card-copy">${t('card.settingsProfiles.copy')}</p>
            </div>
          </div>
          <ul class="cd-profile-list">${profileItems}</ul>
          <div class="cd-inline">
            <button class="cd-btn cd-btn--primary" data-cd-action="create-profile">${t('btn.newProfile')}</button>
            <button class="cd-btn" data-cd-action="export-profile">${t('btn.export')}</button>
            <button class="cd-btn" data-cd-action="import-profile">${t('btn.import')}</button>
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
    const hidden = tab.id !== input.activeTab ? ' cd-hidden' : ''
    const builder = PAGE_BUILDERS[tab.id]
    const inner = builder ? builder(input) : ''
    return `
    <div class="cd-page${hidden}" id="cd-page-${tab.id}">
      ${buildPageTitle(tab.id)}${inner}
    </div>`
  }).join('')

  return `
    <main class="cd-content">
      <section class="cd-toolbar">
        <div class="cd-toolbar-meta">
          <div class="cd-kicker">${t('toolbar.kicker')}</div>
          <strong>${t('toolbar.tagline')}</strong>
        </div>
        <div class="cd-toolbar-actions">
          <span class="cd-dirty-indicator">${t('dirty.unsavedHint')}</span>
          <button class="cd-btn cd-btn--primary" data-cd-action="save-settings">${t('btn.saveChanges')}</button>
          <button class="cd-btn" data-cd-action="reset-settings">${t('btn.reset')}</button>
        </div>
      </section>${pages}
    </main>`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Canonical page-title markup shared by full build and bounded rerender. */
export function buildPageTitle(tabId: string): string {
  return `<h2 class="cd-page-title">${tabLabel(tabId)}</h2>`
}

export function buildDashboardMarkup(input: DashboardMarkupInput): string {
  return `<div class="${DASHBOARD_ROOT_CLASS} cd-dashboard">${buildSidebar(input.activeTab)}${buildContent(input)}
</div>`
}
