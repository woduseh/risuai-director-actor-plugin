import type { RisuaiApi, AsyncKeyValueStore } from '../contracts/risuai.js'
import type {
  DirectorSettings,
  DirectorPluginState,
  StoredDirectorPromptPreset,
} from '../contracts/types.js'
import { DEFAULT_DIRECTOR_SETTINGS, createEmptyState } from '../contracts/types.js'
import { buildDashboardCss, DASHBOARD_STYLE_ID, DASHBOARD_ROOT_CLASS } from './dashboardCss.js'
import { buildDashboardMarkup, DASHBOARD_TABS } from './dashboardDom.js'
import type { DashboardMarkupInput } from './dashboardDom.js'
import { DashboardLifecycle } from './dashboardLifecycle.js'
import {
  DASHBOARD_SETTINGS_KEY,
  DASHBOARD_PROFILE_MANIFEST_KEY,
  DASHBOARD_LOCALE_KEY,
  createDashboardDraft,
  createPromptPresetFromSettings,
  createDefaultProfileManifest,
  normalizePersistedSettings,
  resolveSelectedPromptPreset,
  mergeDashboardSettingsIntoPluginState,
  createProfileExportPayload,
  createDefaultMemoryOpsStatus,
  computeDocumentCounts,
  computeNotebookFreshness,
  loadDreamState,
  loadMemoryOpsPrefs,
  saveMemoryOpsPrefs,
  DASHBOARD_MEMORY_OPS_PREFS_KEY,
} from './dashboardState.js'
import type {
  DashboardDraft,
  DashboardProfile,
  ProfileManifest,
  ProfileExportPayload,
  MemoryOpsStatus,
} from './dashboardState.js'
import {
  resolveProviderDefaults,
  resolveEmbeddingDefaults,
  testDirectorConnection,
  loadProviderModels,
} from './dashboardModel.js'
import type { ConnectionTestResult } from './dashboardModel.js'
import { t, setLocale, getLocale } from './i18n.js'
import type { DashboardLocale } from './i18n.js'
import { BUILTIN_PROMPT_PRESET_ID } from '../director/prompt.js'
import { backfillCurrentChat } from '../director/backfill.js'
import { DIRECTOR_STATE_STORAGE_KEY, patchLegacyMemory } from '../memory/canonicalStore.js'
import { resolveScopeStorageKey } from '../memory/scopeResolver.js'
import { createDefaultDiagnosticsSnapshot } from '../runtime/diagnostics.js'
import { deleteSummary, deleteContinuityFact, upsertSummary, upsertContinuityFact, deleteWorldFact, upsertWorldFact, deleteEntity, upsertEntity, deleteRelation, upsertRelation } from '../memory/memoryMutations.js'
import { escapeXml } from '../utils/xml.js'
import type { BlockReason } from '../runtime/refreshGuard.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOAST_DURATION_MS = 2500
const TOAST_DURATION_ERROR_MS = 5000
const PROFILE_ID_PREFIX = 'user-profile-'
const IMPORT_STAGING_KEY = 'dashboard-profile-import-staging'

/** Timeout (ms) after which an armed destructive action resets. */
export const ARM_TIMEOUT_MS = 3000

/**
 * Actions that require a two-click arming confirmation before execution.
 * The map value is the i18n key shown on the button while armed.
 */
export const DESTRUCTIVE_ACTIONS: ReadonlyMap<string, import('./i18n.js').TranslationKey> = new Map([
  ['delete-summary', 'confirm.deleteMemory'],
  ['delete-continuity-fact', 'confirm.deleteMemory'],
  ['delete-world-fact', 'confirm.deleteMemory'],
  ['delete-entity', 'confirm.deleteMemory'],
  ['delete-relation', 'confirm.deleteMemory'],
  ['bulk-delete-memory', 'confirm.bulkDeleteMemory'],
  ['regenerate-current-chat', 'confirm.regenerateCurrentChat'],
  ['delete-prompt-preset', 'confirm.deletePromptPreset'],
])

/**
 * Action names that must not be double-fired while a previous
 * invocation is still in flight.
 */
export const GUARDED_ACTIONS: ReadonlySet<string> = new Set([
  'save',
  'discard',
  'test-connection',
  'refresh-models',
  'import-profile',
  'backfill-current-chat',
  'regenerate-current-chat',
  'force-extract',
  'force-dream',
  'bulk-delete-memory',
])

// ---------------------------------------------------------------------------
// Toast severity
// ---------------------------------------------------------------------------

export type ToastSeverity = 'success' | 'info' | 'warning' | 'error'

// ---------------------------------------------------------------------------
// Module-level singleton guard
// ---------------------------------------------------------------------------

let activeInstance: DashboardInstance | null = null

// ---------------------------------------------------------------------------
// Store adapter
// ---------------------------------------------------------------------------

/**
 * Abstraction over the persistence layer so dashboardApp can load/save
 * settings and profile manifests and optionally mirror into
 * CanonicalStore-compatible state.
 */
export interface DashboardStore {
  storage: AsyncKeyValueStore
  /** The storage key used to persist canonical state. */
  stateStorageKey?: string
  mirrorToCanonical?: (settings: DirectorSettings) => Promise<void>
  readCanonical?: () => Promise<DirectorPluginState>
  writeCanonical?: (
    mutator: (state: DirectorPluginState) => DirectorPluginState,
  ) => Promise<DirectorPluginState>
  /** Optional callback to trigger an extraction pass from the runtime. */
  forceExtract?: () => Promise<void>
  /** Optional callback to trigger a dream/consolidation pass from the runtime. */
  forceDream?: () => Promise<void>
  /** Optional callback to retrieve the most recent recalled documents. */
  getRecalledDocs?: () => Promise<Array<{ id: string; title: string; freshness: 'current' | 'stale' | 'archived' }>>
  /** Optional callback to check if a consolidation lock is held. */
  isMemoryLocked?: () => Promise<boolean>
  /** Optional callback to load the runtime diagnostics snapshot. */
  loadDiagnostics?: () => Promise<import('../runtime/diagnostics.js').DiagnosticsSnapshot>
  /** Optional callback to check whether the refresh guard is currently blocking heavy maintenance. */
  checkRefreshGuard?: () => import('../runtime/refreshGuard.js').BlockStatus
  /** Optional callback to stamp a maintenance window in the refresh guard. */
  markMaintenance?: (kind: import('../runtime/refreshGuard.js').MaintenanceKind) => Promise<void>
}

/**
 * Build a `DashboardStore` from the api's pluginStorage.
 * If a CanonicalStore-compatible `writeFirst` is available, mirror saved
 * settings into the canonical plugin state.
 *
 * @param stateStorageKey - The scoped key under which canonical state
 *   is stored. Defaults to {@link DIRECTOR_STATE_STORAGE_KEY}.
 */
export function createDashboardStore(
  api: RisuaiApi,
  canonicalWriteFirst?: (
    mutator: (s: DirectorPluginState) => DirectorPluginState,
  ) => Promise<DirectorPluginState>,
  stateStorageKey?: string,
): DashboardStore {
  const store: DashboardStore = {
    storage: api.pluginStorage,
  }
  if (stateStorageKey !== undefined) {
    store.stateStorageKey = stateStorageKey
  }
  if (canonicalWriteFirst) {
    store.mirrorToCanonical = async (settings) => {
      await canonicalWriteFirst((s) =>
        mergeDashboardSettingsIntoPluginState(s, settings),
      )
    }
    store.writeCanonical = canonicalWriteFirst
  }
  return store
}

// ---------------------------------------------------------------------------
// Minimal empty plugin state (for markup input only)
// ---------------------------------------------------------------------------

function createShellPluginState(settings: DirectorSettings): DirectorPluginState {
  const now = Date.now()
  return {
    schemaVersion: 1,
    projectKey: '',
    characterKey: '',
    sessionKey: '',
    updatedAt: now,
    settings,
    director: {
      currentSceneId: '', scenePhase: 'setup', pacingMode: 'steady',
      registerLock: null, povLock: null, continuityFacts: [],
      activeArcs: [], ensembleWeights: {}, failureHistory: [],
      cooldown: { failures: 0, untilTs: null },
    },
    actor: {
      identityAnchor: [], decisionChain: [], behavioralLocks: [],
      relationshipMap: {}, currentIntentHints: [],
    },
    memory: {
      summaries: [], entities: [], relations: [],
      worldFacts: [], sceneLedger: [], turnArchive: [],
      continuityFacts: [],
    },
    metrics: {
      totalDirectorCalls: 0, totalDirectorFailures: 0,
      totalMemoryWrites: 0, lastUpdatedAt: now,
    },
  }
}

// ---------------------------------------------------------------------------
// Canonical state reader
// ---------------------------------------------------------------------------

async function readCanonicalState(store: DashboardStore): Promise<DirectorPluginState> {
  if (store.readCanonical) {
    return structuredClone(await store.readCanonical())
  }
  const key = store.stateStorageKey ?? DIRECTOR_STATE_STORAGE_KEY
  const raw = await store.storage.getItem<DirectorPluginState>(key)
  if (!raw) {
    return createEmptyState()
  }
  const state = structuredClone(raw)
  patchLegacyMemory(state)
  return state
}

// ---------------------------------------------------------------------------
// Memory ops helpers
// ---------------------------------------------------------------------------

function computeLatestMemoryTs(state: DirectorPluginState): number {
  let latest = 0
  for (const s of state.memory.summaries) latest = Math.max(latest, s.updatedAt ?? 0)
  for (const w of state.memory.worldFacts) latest = Math.max(latest, w.updatedAt ?? 0)
  for (const e of state.memory.entities) latest = Math.max(latest, e.updatedAt ?? 0)
  for (const r of state.memory.relations) latest = Math.max(latest, r.updatedAt ?? 0)
  return latest
}

function buildStaleWarnings(
  lastExtractTs: number,
  lastDreamTs: number,
): string[] {
  const warnings: string[] = []
  const now = Date.now()
  const STALE_MS = 24 * 60 * 60 * 1000
  if (lastExtractTs > 0 && now - lastExtractTs > STALE_MS) {
    warnings.push(t('memoryOps.staleExtract'))
  }
  if (lastDreamTs > 0 && now - lastDreamTs > STALE_MS) {
    warnings.push(t('memoryOps.staleDream'))
  }
  return warnings
}

async function buildMemoryOpsStatus(
  store: DashboardStore,
  canonicalState: DirectorPluginState,
): Promise<MemoryOpsStatus> {
  const dreamState = await loadDreamState(store.storage)
  const prefs = await loadMemoryOpsPrefs(store.storage)
  const isLocked = store.isMemoryLocked
    ? await store.isMemoryLocked()
    : false
  const latestMemoryTs = computeLatestMemoryTs(canonicalState)
  const diagnostics = store.loadDiagnostics
    ? await store.loadDiagnostics()
    : createDefaultDiagnosticsSnapshot()

  return {
    lastExtractTs: latestMemoryTs,
    lastDreamTs: dreamState.lastDreamTs,
    notebookFreshness: computeNotebookFreshness(latestMemoryTs, dreamState.lastDreamTs),
    documentCounts: computeDocumentCounts(canonicalState.memory),
    fallbackRetrievalEnabled: prefs.fallbackRetrievalEnabled,
    isMemoryLocked: isLocked,
    staleWarnings: buildStaleWarnings(latestMemoryTs, dreamState.lastDreamTs),
    recalledDocs: [],
    diagnostics,
  }
}

// ---------------------------------------------------------------------------
// Refresh guard helpers
// ---------------------------------------------------------------------------

function guardReasonToast(reason: BlockReason): string {
  switch (reason) {
    case 'startup': return t('guard.blockedStartup')
    case 'shutdown': return t('guard.blockedShutdown')
    case 'maintenance': return t('guard.blockedMaintenance')
    default: return t('guard.blockedMaintenance')
  }
}

// ---------------------------------------------------------------------------
// Dashboard instance
// ---------------------------------------------------------------------------

class DashboardInstance {
  private readonly api: RisuaiApi
  private readonly store: DashboardStore
  private readonly lifecycle = new DashboardLifecycle()
  private readonly doc: Document

  private draft: DashboardDraft
  private profiles: ProfileManifest
  private activeTab: string
  private modelOptions: string[]
  private connectionStatus: { kind: string; message: string }
  private root: HTMLElement | null = null
  private canonicalState: DirectorPluginState
  private readonly selectedMemoryKeys = new Set<string>()
  private editingMemory: {
    kind: 'summary' | 'continuity-fact' | 'world-fact' | 'entity' | 'relation'
    id: string
  } | null = null
  private memoryOpsStatus: MemoryOpsStatus

  /** Action names currently in flight (used by async busy guards). */
  private readonly busyActions = new Set<string>()

  /**
   * Tracks armed destructive actions.  Key = composite arm key
   * (action + optional item id), value = original button text.
   * A second click while armed executes the action; timeout or
   * rerender clears the map.
   */
  private readonly armedActions = new Map<string, string>()

  constructor(
    api: RisuaiApi,
    store: DashboardStore,
    doc: Document,
    draft: DashboardDraft,
    profiles: ProfileManifest,
    modelOptions: string[],
    canonicalState: DirectorPluginState,
    memoryOpsStatus: MemoryOpsStatus,
  ) {
    this.api = api
    this.store = store
    this.doc = doc
    this.draft = draft
    this.profiles = profiles
    this.activeTab = DASHBOARD_TABS[0]?.id ?? 'general'
    this.modelOptions = modelOptions
    this.connectionStatus = { kind: 'idle', message: t('connection.notTested') }
    this.canonicalState = canonicalState
    this.memoryOpsStatus = memoryOpsStatus
  }

  // ── public ────────────────────────────────────────────────────────────

  async mount(): Promise<void> {
    this.injectCss()
    this.renderRoot()
    this.bindEvents()
    await this.api.showContainer('fullscreen')
  }

  async close(): Promise<void> {
    this.clearArmedState()
    this.lifecycle.teardown()
    this.removeDom()
    await this.api.hideContainer()
    if (activeInstance === this) activeInstance = null
  }

  /** Return the storage key that canonical state is persisted under. */
  private resolveStateKey(): string {
    return this.store.stateStorageKey ?? DIRECTOR_STATE_STORAGE_KEY
  }

  // ── CSS ───────────────────────────────────────────────────────────────

  private injectCss(): void {
    const existing = this.doc.getElementById(DASHBOARD_STYLE_ID)
    if (existing) existing.remove()

    const style = this.doc.createElement('style')
    style.id = DASHBOARD_STYLE_ID
    style.textContent = buildDashboardCss()
    this.doc.head.appendChild(style)

    this.lifecycle.onTeardown(() => {
      const el = this.doc.getElementById(DASHBOARD_STYLE_ID)
      if (el) el.remove()
    })
  }

  // ── DOM ───────────────────────────────────────────────────────────────

  private buildMarkupInput(): DashboardMarkupInput {
    return {
      settings: this.draft.settings,
      pluginState: this.canonicalState,
      profiles: this.profiles,
      activeTab: this.activeTab,
      modelOptions: this.modelOptions,
      connectionStatus: this.connectionStatus,
      selectedMemoryKeys: Array.from(this.selectedMemoryKeys),
      editingMemory: this.editingMemory,
      memoryOpsStatus: this.memoryOpsStatus,
    }
  }

  private renderRoot(): void {
    // Remove ALL existing roots (defensive)
    for (const el of Array.from(this.doc.querySelectorAll(`.${DASHBOARD_ROOT_CLASS}`))) {
      el.remove()
    }

    // buildDashboardMarkup already produces a <div class="da-root da-dashboard">
    // wrapper, so inject directly — no extra wrapping needed
    const container = this.doc.createElement('div')
    container.innerHTML = buildDashboardMarkup(this.buildMarkupInput())
    const wrapper = container.firstElementChild as HTMLElement
    if (!wrapper) return

    // Inject close button into sidebar
    const sidebar = wrapper.querySelector('.da-sidebar')
    if (sidebar) {
      const closeBtn = this.doc.createElement('button')
      closeBtn.className = 'da-btn da-close-btn'
      closeBtn.setAttribute('data-da-action', 'close')
      closeBtn.textContent = t('btn.closeIcon')
      sidebar.appendChild(closeBtn)
    }

    // Inject footer with save/discard into content area
    const content = wrapper.querySelector('.da-content')
    if (content) {
      const footer = this.doc.createElement('div')
      footer.className = 'da-footer'
      footer.innerHTML = this.buildFooterHtml()
      content.appendChild(footer)
    }

    this.doc.body.appendChild(wrapper)
    this.root = wrapper

    this.lifecycle.onTeardown(() => {
      this.removeDom()
    })
  }

  private buildFooterHtml(): string {
    const dirtyClass = this.draft.isDirty ? '' : ' da-hidden'
    return [
      `<span class="da-dirty-indicator${dirtyClass}" data-da-role="dirty">${t('dirty.unsavedChanges')}</span>`,
      `<div style="display:flex;gap:8px;margin-left:auto">`,
      `  <button class="da-btn" data-da-action="discard">${t('btn.discard')}</button>`,
      `  <button class="da-btn da-btn--primary" data-da-action="save">${t('btn.save')}</button>`,
      `</div>`,
    ].join('\n')
  }

  private removeDom(): void {
    if (this.root?.parentNode) {
      this.root.parentNode.removeChild(this.root)
      this.root = null
    }
  }

  // ── Re-render helpers ─────────────────────────────────────────────────

  private fullReRender(): void {
    if (!this.root) return
    const parent = this.root.parentNode
    if (!parent) return

    this.clearArmedState()
    this.root.remove()

    const container = this.doc.createElement('div')
    container.innerHTML = buildDashboardMarkup(this.buildMarkupInput())
    const wrapper = container.firstElementChild as HTMLElement
    if (!wrapper) return

    const sidebar = wrapper.querySelector('.da-sidebar')
    if (sidebar) {
      const closeBtn = this.doc.createElement('button')
      closeBtn.className = 'da-btn da-close-btn'
      closeBtn.setAttribute('data-da-action', 'close')
      closeBtn.textContent = t('btn.closeIcon')
      sidebar.appendChild(closeBtn)
    }

    const content = wrapper.querySelector('.da-content')
    if (content) {
      const footer = this.doc.createElement('div')
      footer.className = 'da-footer'
      footer.innerHTML = this.buildFooterHtml()
      content.appendChild(footer)
    }

    parent.appendChild(wrapper)
    this.root = wrapper
    this.bindEvents()
    this.applyAllBusyStates()
  }

  private updateConnectionStatusDom(): void {
    if (!this.root) return
    const el = this.root.querySelector('.da-connection-status')
    if (!el) return
    el.setAttribute('data-da-status', this.connectionStatus.kind)
    el.textContent = this.connectionStatus.message
  }

  private updateModelSelectDom(): void {
    if (!this.root) return
    const sel = this.root.querySelector(
      'select[data-da-field="directorModel"]',
    ) as HTMLSelectElement | null
    if (!sel) return
    sel.innerHTML = this.modelOptions
      .map(
        (m) =>
          `<option value="${escapeXml(m)}"${m === this.draft.settings.directorModel ? ' selected' : ''}>${escapeXml(m)}</option>`,
      )
      .join('')
  }

  private updateDirtyIndicator(): void {
    if (!this.root) return
    const indicator = this.root.querySelector('[data-da-role="dirty"]')
    if (indicator) {
      indicator.classList.toggle('da-hidden', !this.draft.isDirty)
    }
  }

  private getSelectedPromptPreset(): StoredDirectorPromptPreset {
    return resolveSelectedPromptPreset(this.draft.settings)
  }

  private getSelectedCustomPromptPreset(): StoredDirectorPromptPreset | null {
    if (this.draft.settings.promptPresetId === BUILTIN_PROMPT_PRESET_ID) {
      return null
    }

    return this.draft.settings.promptPresets[this.draft.settings.promptPresetId] ?? null
  }

  private markDirty(): void {
    this.draft.isDirty = true
    this.updateDirtyIndicator()
  }

  // ── Async busy guards ──────────────────────────────────────────────────

  /** True when `actionName` is currently in flight. */
  isActionBusy(actionName: string): boolean {
    return this.busyActions.has(actionName)
  }

  /**
   * Run `fn` while marking `actionName` as busy.
   * A second click on the same action is silently ignored until the
   * first promise settles.  The triggering button is disabled for
   * the duration so the user gets visible feedback via the CSS
   * disabled-state rule from UI-1.
   */
  private async withBusyGuard(
    actionName: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    if (this.busyActions.has(actionName)) return
    this.busyActions.add(actionName)
    this.setBusyDisabled(actionName, true)
    try {
      await fn()
    } finally {
      this.busyActions.delete(actionName)
      this.setBusyDisabled(actionName, false)
    }
  }

  /**
   * Set or clear the `disabled` attribute on the button that owns
   * `actionName`.  When *clearing*, respects the bulk-delete
   * "no items selected" invariant so we never incorrectly re-enable
   * that button.
   */
  private setBusyDisabled(actionName: string, busy: boolean): void {
    if (!this.root) return
    const btn = this.root.querySelector(
      `[data-da-action="${actionName}"]`,
    ) as HTMLButtonElement | null
    if (!btn) return

    if (busy) {
      btn.disabled = true
      return
    }
    // When un-busying bulk-delete, keep it disabled if nothing is selected
    if (actionName === 'bulk-delete-memory' && this.selectedMemoryKeys.size === 0) {
      btn.disabled = true
      return
    }
    btn.disabled = false
  }

  /**
   * Re-apply disabled states for every action that is still in flight.
   * Called after `fullReRender()` replaces the DOM tree.
   */
  private applyAllBusyStates(): void {
    for (const actionName of this.busyActions) {
      this.setBusyDisabled(actionName, true)
    }
  }

  // ── Destructive-action arming ─────────────────────────────────────────

  /**
   * Build a composite key that uniquely identifies an armed action.
   * For per-item buttons (e.g. delete-summary) the key includes the
   * item id so arming one row does not arm all rows.
   */
  private static armKey(action: string, btn: HTMLElement): string {
    const itemId = btn.getAttribute('data-da-item-id')
    return itemId ? `${action}::${itemId}` : action
  }

  /** Clear all armed states and restore original button text in the DOM. */
  private clearArmedState(): void {
    if (this.armedActions.size === 0) return
    for (const [key, originalText] of this.armedActions) {
      const btn = this.findArmedBtn(key)
      if (btn) {
        btn.textContent = originalText
        btn.classList.remove('da-btn--armed')
      }
    }
    this.armedActions.clear()
  }

  /** Locate a DOM button from its arm-key (action + optional item id). */
  private findArmedBtn(armKey: string): HTMLElement | null {
    if (!this.root) return null
    const sepIdx = armKey.indexOf('::')
    if (sepIdx === -1) {
      return this.root.querySelector(`[data-da-action="${armKey}"]`)
    }
    const action = armKey.slice(0, sepIdx)
    const itemId = armKey.slice(sepIdx + 2)
    return this.root.querySelector(
      `[data-da-action="${action}"][data-da-item-id="${itemId}"]`,
    )
  }

  /**
   * Two-click arming gate for destructive actions.
   *
   * - First click: arms the button (changes text, adds armed CSS class,
   *   starts auto-reset timer).
   * - Second click while armed: returns `true` so the caller can proceed
   *   with the actual mutation.
   *
   * Arming state is tracked in the controller (survives in-place DOM
   * mutations) and cleared on `fullReRender()` / `close()`.
   */
  private armOrExecute(action: string, btn: HTMLElement): boolean {
    const key = DashboardInstance.armKey(action, btn)

    if (this.armedActions.has(key)) {
      // Second click — disarm and signal "execute"
      this.armedActions.delete(key)
      btn.classList.remove('da-btn--armed')
      return true
    }

    // First click — arm
    const confirmKey = DESTRUCTIVE_ACTIONS.get(action)
    if (!confirmKey) return true // not a destructive action

    this.armedActions.set(key, btn.textContent ?? '')
    btn.textContent = t(confirmKey)
    btn.classList.add('da-btn--armed')

    this.lifecycle.setTimeout(() => {
      if (!this.armedActions.has(key)) return
      const domBtn = this.findArmedBtn(key)
      if (domBtn) {
        domBtn.textContent = this.armedActions.get(key) ?? ''
        domBtn.classList.remove('da-btn--armed')
      }
      this.armedActions.delete(key)
    }, ARM_TIMEOUT_MS)

    return false
  }

  // ── Event binding ─────────────────────────────────────────────────────

  private bindEvents(): void {
    if (!this.root) return

    this.lifecycle.listen(this.root, 'click', (e) => {
      const target = e.target as HTMLElement
      this.handleTabClick(target)
      void this.handleActionClick(target)
      this.handleProfileSelect(target)
    })

    this.lifecycle.listen(this.root, 'change', (e) => {
      const target = e.target as HTMLElement
      if (
        target instanceof HTMLInputElement &&
        target.getAttribute('data-da-role') === 'memory-select'
      ) {
        this.handleMemorySelectionChange(target)
        return
      }
      if (
        target instanceof HTMLSelectElement &&
        target.getAttribute('data-da-role') === 'prompt-preset-select'
      ) {
        this.handlePromptPresetSelect(target.value)
        return
      }
      this.handleFieldChange(target)
    })

    this.lifecycle.listen(this.root, 'input', (e) => {
      const el = e.target as HTMLElement
      if (
        el instanceof HTMLInputElement &&
        el.getAttribute('data-da-role') === 'memory-filter'
      ) {
        this.handleMemoryFilter(el.value)
        return
      }
      if (
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
        typeof el.getAttribute('data-da-role') === 'string' &&
        el.getAttribute('data-da-role')?.startsWith('prompt-')
      ) {
        this.handlePromptPresetInput(el)
        return
      }
      if (
        el instanceof HTMLInputElement &&
        (el.type === 'text' || el.type === 'password' || el.type === 'number')
      ) {
        this.handleFieldChange(el)
      }
    })
  }

  private handleTabClick(target: HTMLElement): void {
    const btn = target.closest('[data-da-target]') as HTMLElement | null
    if (!btn) return
    const tabId = btn.getAttribute('data-da-target')
    if (!tabId) return

    this.activeTab = tabId

    // Update sidebar active state
    if (this.root) {
      for (const b of Array.from(this.root.querySelectorAll('.da-sidebar-btn'))) {
        b.classList.toggle(
          'da-sidebar-btn--active',
          b.getAttribute('data-da-target') === tabId,
        )
      }
    }

    // Toggle page visibility
    if (this.root) {
      for (const page of Array.from(this.root.querySelectorAll('.da-page'))) {
        const pageId = page.id.replace('da-page-', '')
        page.classList.toggle('da-hidden', pageId !== tabId)
      }
    }
  }

  private async handleActionClick(target: HTMLElement): Promise<void> {
    const btn = target.closest('[data-da-action]') as HTMLElement | null
    if (!btn) return
    const action = btn.getAttribute('data-da-action')

    // Gate destructive actions through the two-click arming flow
    if (action && DESTRUCTIVE_ACTIONS.has(action)) {
      if (!this.armOrExecute(action, btn)) return
    }

    switch (action) {
      case 'close':
        await this.close()
        break
      case 'save':
        await this.withBusyGuard('save', () => this.handleSave())
        break
      case 'discard':
        await this.withBusyGuard('discard', () => this.handleDiscard())
        break
      case 'test-connection':
        await this.withBusyGuard('test-connection', () => this.handleTestConnection())
        break
      case 'refresh-models':
        await this.withBusyGuard('refresh-models', () => this.handleRefreshModels())
        break
      case 'create-profile':
        await this.handleCreateProfile()
        break
      case 'export-profile':
        await this.handleExportProfile()
        break
      case 'import-profile':
        await this.withBusyGuard('import-profile', () => this.handleImportProfile())
        break
      case 'create-prompt-preset':
        this.handleCreatePromptPreset()
        break
      case 'delete-prompt-preset':
        this.handleDeletePromptPreset()
        break
      case 'backfill-current-chat':
        await this.withBusyGuard('backfill-current-chat', () => this.handleBackfillCurrentChat())
        break
      case 'regenerate-current-chat':
        await this.withBusyGuard('regenerate-current-chat', () => this.handleRegenerateCurrentChat())
        break
      case 'bulk-delete-memory':
        await this.withBusyGuard('bulk-delete-memory', () => this.handleBulkDeleteMemory())
        break
      case 'edit-memory-item':
        this.handleEditMemoryItem(btn)
        break
      case 'save-memory-edit':
        await this.handleSaveMemoryEdit(btn)
        break
      case 'cancel-memory-edit':
        this.handleCancelMemoryEdit()
        break
      case 'switch-lang':
        await this.handleSwitchLang(btn)
        break
      case 'delete-summary':
        await this.handleDeleteMemoryItem(btn, 'summary')
        break
      case 'delete-continuity-fact':
        await this.handleDeleteMemoryItem(btn, 'continuity-fact')
        break
      case 'add-summary':
        await this.handleAddMemoryItem('summary')
        break
      case 'add-continuity-fact':
        await this.handleAddMemoryItem('continuity-fact')
        break
      case 'delete-world-fact':
        await this.handleDeleteMemoryItem(btn, 'world-fact')
        break
      case 'add-world-fact':
        await this.handleAddMemoryItem('world-fact')
        break
      case 'delete-entity':
        await this.handleDeleteMemoryItem(btn, 'entity')
        break
      case 'add-entity':
        await this.handleAddMemoryItem('entity')
        break
      case 'delete-relation':
        await this.handleDeleteMemoryItem(btn, 'relation')
        break
      case 'add-relation':
        await this.handleAddRelation()
        break
      case 'force-extract':
        await this.withBusyGuard('force-extract', () => this.handleForceExtract())
        break
      case 'force-dream':
        await this.withBusyGuard('force-dream', () => this.handleForceDream())
        break
      case 'inspect-recalled':
        await this.handleInspectRecalled()
        break
      case 'toggle-fallback-retrieval':
        await this.handleToggleFallbackRetrieval()
        break
    }
  }

  private handleProfileSelect(target: HTMLElement): void {
    const item = target.closest('.da-profile-item') as HTMLElement | null
    if (!item) return
    if (target.closest('[data-da-action]')) return

    const profileId = item.getAttribute('data-da-profile-id')
    if (!profileId) return

    this.selectProfile(profileId)
  }

  private handleFieldChange(el: HTMLElement): void {
    const field = el.getAttribute('data-da-field')
    if (!field) return
    if (!(field in this.draft.settings)) return

    const key = field as keyof DirectorSettings
    let value: unknown

    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox') {
        value = el.checked
      } else if (el.type === 'number') {
        value = Number(el.value)
      } else {
        value = el.value
      }
    } else if (el instanceof HTMLSelectElement) {
      value = el.value
    } else {
      return
    }

    const defaults = DEFAULT_DIRECTOR_SETTINGS
    if (typeof defaults[key] === typeof value) {
      ;(this.draft.settings as unknown as Record<string, unknown>)[key] = value
      this.markDirty()
    }

    // Provider change → apply base URL defaults
    if (key === 'directorProvider') {
      const providerDefaults = resolveProviderDefaults(
        value as DirectorSettings['directorProvider'],
      )
      this.draft.settings.directorBaseUrl = providerDefaults.baseUrl
      this.modelOptions = Array.from(
        new Set([
          this.draft.settings.directorModel,
          ...providerDefaults.curatedModels,
        ]),
      )
      this.markDirty()

      const baseUrlInput = this.root?.querySelector(
        '[data-da-field="directorBaseUrl"]',
      ) as HTMLInputElement | null
      if (baseUrlInput) {
        baseUrlInput.value = providerDefaults.baseUrl
      }
      this.updateModelSelectDom()
    }

    if (key === 'embeddingProvider') {
      const providerDefaults = resolveEmbeddingDefaults(
        value as DirectorSettings['embeddingProvider'],
      )
      this.draft.settings.embeddingBaseUrl = providerDefaults.baseUrl
      this.markDirty()

      const baseUrlInput = this.root?.querySelector(
        '[data-da-field="embeddingBaseUrl"]',
      ) as HTMLInputElement | null
      if (baseUrlInput) {
        baseUrlInput.value = providerDefaults.baseUrl
      }
    }
  }

  // ── Save / Discard ────────────────────────────────────────────────────

  private async handleSave(): Promise<void> {
    await this.store.storage.setItem(
      DASHBOARD_SETTINGS_KEY,
      structuredClone(this.draft.settings),
    )

    await this.store.storage.setItem(
      DASHBOARD_PROFILE_MANIFEST_KEY,
      structuredClone(this.profiles),
    )

    if (this.store.mirrorToCanonical) {
      await this.store.mirrorToCanonical(this.draft.settings)
    }

    this.draft.isDirty = false
    this.updateDirtyIndicator()
    this.showToast(t('toast.settingsSaved'), 'success')
  }

  private async handleDiscard(): Promise<void> {
    const raw = await this.store.storage.getItem<Partial<DirectorSettings>>(
      DASHBOARD_SETTINGS_KEY,
    )
    this.draft = createDashboardDraft(
      normalizePersistedSettings(raw ?? {}),
    )
    this.fullReRender()
    this.showToast(t('toast.changesDiscarded'), 'info')
  }

  // ── Connection status helpers ────────────────────────────────────────

  /** Re-derive a localized message from `kind`, preserving raw error text. */
  private localizedConnectionMessage(): string {
    switch (this.connectionStatus.kind) {
      case 'idle': return t('connection.notTested')
      case 'testing': return t('connection.testing')
      case 'ok': return t('connection.connected', { count: String(this.modelOptions.length) })
      default: return this.connectionStatus.message
    }
  }

  // ── Connection test ───────────────────────────────────────────────────

  private async handleTestConnection(): Promise<void> {
    this.connectionStatus = { kind: 'testing', message: t('connection.testing') }
    this.updateConnectionStatusDom()

    const result: ConnectionTestResult = await testDirectorConnection(
      this.api,
      this.draft.settings,
    )

    if (result.ok) {
      this.connectionStatus = {
        kind: 'ok',
        message: t('connection.connected', { count: String(result.models.length) }),
      }
      this.modelOptions = result.models
      this.updateModelSelectDom()
    } else {
      this.connectionStatus = {
        kind: 'error',
        message: result.error,
      }
    }
    this.updateConnectionStatusDom()
  }

  private async handleRefreshModels(): Promise<void> {
    try {
      const models = await loadProviderModels(this.api, this.draft.settings)
      this.modelOptions = models.includes(this.draft.settings.directorModel)
        ? models
        : [this.draft.settings.directorModel, ...models]
      this.updateModelSelectDom()
    } catch (error) {
      this.connectionStatus = {
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      }
      this.updateConnectionStatusDom()
    }
  }

  // ── Profile flows ─────────────────────────────────────────────────────

  private async handleCreateProfile(): Promise<void> {
    const now = Date.now()
    const id = `${PROFILE_ID_PREFIX}${String(now)}-${Math.random().toString(36).slice(2, 6)}`
    const newProfile: DashboardProfile = {
      id,
      name: t('profile.defaultName', { n: String(this.profiles.profiles.length + 1) }),
      createdAt: now,
      updatedAt: now,
      basedOn: this.profiles.activeProfileId,
      overrides: {},
    }
    this.profiles.profiles.push(newProfile)
    this.profiles.activeProfileId = id
    this.draft.isDirty = true

    await this.store.storage.setItem(
      DASHBOARD_PROFILE_MANIFEST_KEY,
      structuredClone(this.profiles),
    )

    this.fullReRender()
    this.showToast(t('toast.profileCreated'), 'success')
  }

  private selectProfile(profileId: string): void {
    const profile = this.profiles.profiles.find((p) => p.id === profileId)
    if (!profile) return

    this.profiles.activeProfileId = profileId

    // Apply profile overrides to the current defaults
    const base = normalizePersistedSettings({})
    const merged = { ...base, ...profile.overrides }
    this.draft.settings = merged
    this.draft.isDirty = true

    this.fullReRender()
  }

  private async handleExportProfile(): Promise<void> {
    const activeProfile = this.profiles.profiles.find(
      (p) => p.id === this.profiles.activeProfileId,
    )
    if (!activeProfile) {
      this.showToast(t('toast.noProfileSelected'), 'warning')
      return
    }
    const payload = createProfileExportPayload(activeProfile)
    const json = JSON.stringify(payload, null, 2)
    await this.api.alert(json)
    this.showToast(t('toast.profileExported'), 'success')
  }

  private async handleImportProfile(): Promise<void> {
    const raw = await this.store.storage.getItem<string>(IMPORT_STAGING_KEY)

    if (!raw) {
      await this.api.alert(
        t('alert.importInstructions', { key: IMPORT_STAGING_KEY }),
      )
      return
    }

    try {
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
      const parsed = JSON.parse(text) as unknown

      if (!isValidExportPayload(parsed)) {
        await this.api.alertError(t('toast.invalidProfileFormat'))
        return
      }

      const payload = parsed as ProfileExportPayload
      const imported = { ...payload.profile }

      if (this.profiles.profiles.some((p) => p.id === imported.id)) {
        imported.id = `${PROFILE_ID_PREFIX}imported-${String(Date.now())}`
      }

      this.profiles.profiles.push(imported)
      this.profiles.activeProfileId = imported.id
      this.draft.isDirty = true

      await this.store.storage.setItem(
        DASHBOARD_PROFILE_MANIFEST_KEY,
        structuredClone(this.profiles),
      )
      await this.store.storage.removeItem(IMPORT_STAGING_KEY)

      this.fullReRender()
      this.showToast(t('toast.profileImported'), 'success')
    } catch {
      await this.api.alertError(t('toast.failedParseProfile'))
    }
  }

  private handlePromptPresetSelect(presetId: string): void {
    this.draft.settings.promptPresetId =
      presetId === BUILTIN_PROMPT_PRESET_ID ||
      this.draft.settings.promptPresets[presetId] != null
        ? presetId
        : BUILTIN_PROMPT_PRESET_ID
    this.markDirty()
    this.fullReRender()
  }

  private handleCreatePromptPreset(): void {
    const preset = createPromptPresetFromSettings(this.draft.settings)
    this.draft.settings.promptPresets[preset.id] = preset
    this.draft.settings.promptPresetId = preset.id
    this.markDirty()
    this.fullReRender()
  }

  private handleDeletePromptPreset(): void {
    const current = this.getSelectedCustomPromptPreset()
    if (!current) return
    delete this.draft.settings.promptPresets[current.id]
    this.draft.settings.promptPresetId = BUILTIN_PROMPT_PRESET_ID
    this.markDirty()
    this.fullReRender()
  }

  private handlePromptPresetInput(
    el: HTMLInputElement | HTMLTextAreaElement,
  ): void {
    const current = this.getSelectedCustomPromptPreset()
    if (!current) return

    const role = el.getAttribute('data-da-role')
    if (!role) return

    switch (role) {
      case 'prompt-preset-name':
        current.name = el.value.trim() || current.name
        break
      case 'prompt-pre-request-system':
        current.preset.preRequestSystemTemplate = el.value
        break
      case 'prompt-pre-request-user':
        current.preset.preRequestUserTemplate = el.value
        break
      case 'prompt-post-response-system':
        current.preset.postResponseSystemTemplate = el.value
        break
      case 'prompt-post-response-user':
        current.preset.postResponseUserTemplate = el.value
        break
      case 'prompt-max-recent-messages': {
        const numeric = Number(el.value)
        current.preset.maxRecentMessages = Number.isFinite(numeric) && numeric > 0
          ? Math.floor(numeric)
          : this.getSelectedPromptPreset().preset.maxRecentMessages
        break
      }
      default:
        return
    }

    current.updatedAt = Date.now()
    this.markDirty()
  }

  private async handleBackfillCurrentChat(): Promise<void> {
    if (this.store.checkRefreshGuard) {
      const status = this.store.checkRefreshGuard()
      if (status.blocked) {
        this.showToast(guardReasonToast(status.reason!), 'warning')
        return
      }
    }
    if (this.store.markMaintenance) {
      await this.store.markMaintenance('backfill-current-chat')
    }

    const resolution = await resolveScopeStorageKey(this.api)
    if (resolution.storageKey !== this.resolveStateKey()) {
      await this.api.alertError(t('error.backfillScopeMismatch'))
      return
    }

    const result = await backfillCurrentChat(this.api, {
      load: async () => structuredClone(await readCanonicalState(this.store)),
      save: async (next) => {
        if (this.store.writeCanonical) {
          const persisted = await this.store.writeCanonical(() => structuredClone(next))
          this.canonicalState = structuredClone(persisted)
          return
        }

        await this.store.storage.setItem(this.resolveStateKey(), structuredClone(next))
        this.canonicalState = structuredClone(next)
      },
    })

    if (!this.store.writeCanonical) {
      this.canonicalState = await readCanonicalState(this.store)
    }

    this.fullReRender()
    if (result.appliedUpdates > 0) {
      this.showToast(
        t('toast.backfillCompleted', { count: String(result.appliedUpdates) }),
        'success',
      )
      return
    }

    this.showToast(t('toast.backfillSkipped'), 'info')
  }

  private async handleRegenerateCurrentChat(): Promise<void> {
    if (this.store.checkRefreshGuard) {
      const status = this.store.checkRefreshGuard()
      if (status.blocked) {
        this.showToast(guardReasonToast(status.reason!), 'warning')
        return
      }
    }
    if (this.store.markMaintenance) {
      await this.store.markMaintenance('regenerate-current-chat')
    }

    const resolution = await resolveScopeStorageKey(this.api)
    if (resolution.storageKey !== this.resolveStateKey()) {
      await this.api.alertError(t('error.backfillScopeMismatch'))
      return
    }

    const resetCanonical = async (): Promise<void> => {
      if (this.store.writeCanonical) {
        const persisted = await this.store.writeCanonical((current) => {
          const empty = createEmptyState({
            projectKey: current.projectKey,
            characterKey: current.characterKey,
            sessionKey: current.sessionKey,
          })
          empty.settings = structuredClone(current.settings)
          return empty
        })
        this.canonicalState = structuredClone(persisted)
        return
      }

      const current = await readCanonicalState(this.store)
      const empty = createEmptyState({
        projectKey: current.projectKey,
        characterKey: current.characterKey,
        sessionKey: current.sessionKey,
      })
      empty.settings = structuredClone(current.settings)
      await this.store.storage.setItem(this.resolveStateKey(), structuredClone(empty))
      this.canonicalState = empty
    }

    await resetCanonical()
    this.selectedMemoryKeys.clear()
    this.editingMemory = null
    await this.handleBackfillCurrentChat()
  }

  private handleMemorySelectionChange(input: HTMLInputElement): void {
    const itemKey = input.getAttribute('data-da-item-key')
    if (!itemKey) return
    if (input.checked) {
      this.selectedMemoryKeys.add(itemKey)
    } else {
      this.selectedMemoryKeys.delete(itemKey)
    }

    const bulkDeleteBtn = this.root?.querySelector(
      '[data-da-action="bulk-delete-memory"]',
    ) as HTMLButtonElement | null
    if (bulkDeleteBtn) {
      bulkDeleteBtn.disabled = this.selectedMemoryKeys.size === 0
    }
  }

  private handleEditMemoryItem(btn: HTMLElement): void {
    const itemKey = btn.getAttribute('data-da-item-key')
    if (!itemKey) return
    const [kind, id] = itemKey.split(':', 2)
    if (!kind || !id) return
    this.editingMemory = {
      kind: kind as 'summary' | 'continuity-fact' | 'world-fact' | 'entity' | 'relation',
      id,
    }
    this.fullReRender()
  }

  private handleCancelMemoryEdit(): void {
    this.editingMemory = null
    this.fullReRender()
  }

  private async handleSaveMemoryEdit(btn: HTMLElement): Promise<void> {
    const itemKey = btn.getAttribute('data-da-item-key')
    if (!itemKey) return
    const [kind, id] = itemKey.split(':', 2)
    if (!kind || !id) return
    const row = btn.closest('.da-memory-item') as HTMLElement | null
    if (!row) return

    const applyEdit = (state: DirectorPluginState): void => {
      switch (kind) {
        case 'summary': {
          const input = row.querySelector(
            'input[data-da-role="edit-summary-text"]',
          ) as HTMLInputElement | null
          const text = input?.value.trim() ?? ''
          if (!text) return
          upsertSummary(state, { id, text, recencyWeight: 1 })
          break
        }
        case 'continuity-fact': {
          const input = row.querySelector(
            'input[data-da-role="edit-continuity-fact-text"]',
          ) as HTMLInputElement | null
          const text = input?.value.trim() ?? ''
          if (!text) return
          upsertContinuityFact(state, { id, text, priority: 5 })
          break
        }
        case 'world-fact': {
          const input = row.querySelector(
            'input[data-da-role="edit-world-fact-text"]',
          ) as HTMLInputElement | null
          const text = input?.value.trim() ?? ''
          if (!text) return
          upsertWorldFact(state, { id, text })
          break
        }
        case 'entity': {
          const input = row.querySelector(
            'input[data-da-role="edit-entity-name"]',
          ) as HTMLInputElement | null
          const name = input?.value.trim() ?? ''
          if (!name) return
          upsertEntity(state, { id, name })
          break
        }
        case 'relation': {
          const sourceInput = row.querySelector(
            'input[data-da-role="edit-relation-source"]',
          ) as HTMLInputElement | null
          const labelInput = row.querySelector(
            'input[data-da-role="edit-relation-label"]',
          ) as HTMLInputElement | null
          const targetInput = row.querySelector(
            'input[data-da-role="edit-relation-target"]',
          ) as HTMLInputElement | null
          const sourceId = sourceInput?.value.trim() ?? ''
          const label = labelInput?.value.trim() ?? ''
          const targetId = targetInput?.value.trim() ?? ''
          if (!sourceId || !label || !targetId) return
          upsertRelation(state, { id, sourceId, label, targetId })
          break
        }
      }
    }

    if (this.store.writeCanonical) {
      const nextState = await this.store.writeCanonical((current) => {
        applyEdit(current)
        return current
      })
      this.canonicalState = structuredClone(nextState)
    } else {
      const state = await readCanonicalState(this.store)
      applyEdit(state)
      await this.store.storage.setItem(this.resolveStateKey(), structuredClone(state))
      this.canonicalState = state
    }

    this.editingMemory = null
    this.fullReRender()
  }

  private async handleBulkDeleteMemory(): Promise<void> {
    if (this.selectedMemoryKeys.size === 0) return

    if (this.store.checkRefreshGuard) {
      const status = this.store.checkRefreshGuard()
      if (status.blocked) {
        this.showToast(guardReasonToast(status.reason!), 'warning')
        return
      }
    }
    if (this.store.markMaintenance) {
      await this.store.markMaintenance('bulk-delete-memory')
    }

    const applyDelete = (state: DirectorPluginState): void => {
      for (const itemKey of Array.from(this.selectedMemoryKeys)) {
        const [kind, id] = itemKey.split(':', 2)
        if (!kind || !id) continue
        switch (kind) {
          case 'summary': deleteSummary(state, id); break
          case 'continuity-fact': deleteContinuityFact(state, id); break
          case 'world-fact': deleteWorldFact(state, id); break
          case 'entity': deleteEntity(state, id); break
          case 'relation': deleteRelation(state, id); break
        }
      }
    }

    if (this.store.writeCanonical) {
      const nextState = await this.store.writeCanonical((current) => {
        applyDelete(current)
        return current
      })
      this.canonicalState = structuredClone(nextState)
    } else {
      const state = await readCanonicalState(this.store)
      applyDelete(state)
      await this.store.storage.setItem(this.resolveStateKey(), structuredClone(state))
      this.canonicalState = state
    }

    this.selectedMemoryKeys.clear()
    this.fullReRender()
  }

  // ── Memory filter ──────────────────────────────────────────────────────

  private handleMemoryFilter(query: string): void {
    if (!this.root) return
    const needle = query.trim().toLowerCase()
    const items = this.root.querySelectorAll('.da-memory-item')
    for (const item of Array.from(items)) {
      const text = (item.textContent ?? '').toLowerCase()
      item.classList.toggle('da-hidden', needle !== '' && !text.includes(needle))
    }
  }

  // ── Memory delete ──────────────────────────────────────────────────────

  private async handleDeleteMemoryItem(
    btn: HTMLElement,
    kind: 'summary' | 'continuity-fact' | 'world-fact' | 'entity' | 'relation',
  ): Promise<void> {
    const itemId = btn.getAttribute('data-da-item-id')
    if (!itemId) return

    const applyDelete = (state: DirectorPluginState): void => {
      switch (kind) {
        case 'summary': deleteSummary(state, itemId); break
        case 'continuity-fact': deleteContinuityFact(state, itemId); break
        case 'world-fact': deleteWorldFact(state, itemId); break
        case 'entity': deleteEntity(state, itemId); break
        case 'relation': deleteRelation(state, itemId); break
      }
    }

    if (this.store.writeCanonical) {
      const nextState = await this.store.writeCanonical((current) => {
        applyDelete(current)
        return current
      })
      this.canonicalState = structuredClone(nextState)
      this.fullReRender()
      return
    }

    const state = await readCanonicalState(this.store)
    applyDelete(state)
    await this.store.storage.setItem(this.resolveStateKey(), structuredClone(state))
    this.canonicalState = state
    this.fullReRender()
  }

  // ── Memory add ──────────────────────────────────────────────────────

  private async handleAddMemoryItem(
    kind: 'summary' | 'continuity-fact' | 'world-fact' | 'entity',
  ): Promise<void> {
    if (!this.root) return
    const inputRoleMap: Record<typeof kind, string> = {
      'summary': 'add-summary-text',
      'continuity-fact': 'add-fact-text',
      'world-fact': 'add-world-fact-text',
      'entity': 'add-entity-name',
    }
    const inputRole = inputRoleMap[kind]
    const inputEl = this.root.querySelector(
      `input[data-da-role="${inputRole}"]`,
    ) as HTMLInputElement | null
    if (!inputEl) return

    const text = inputEl.value.trim()
    if (!text) return

    const applyAdd = (state: DirectorPluginState): void => {
      switch (kind) {
        case 'summary': upsertSummary(state, { text, recencyWeight: 1 }); break
        case 'continuity-fact': upsertContinuityFact(state, { text, priority: 5 }); break
        case 'world-fact': upsertWorldFact(state, { text }); break
        case 'entity': upsertEntity(state, { name: text }); break
      }
    }

    if (this.store.writeCanonical) {
      const nextState = await this.store.writeCanonical((current) => {
        applyAdd(current)
        return current
      })
      this.canonicalState = structuredClone(nextState)
      this.fullReRender()
      return
    }

    const state = await readCanonicalState(this.store)
    applyAdd(state)
    await this.store.storage.setItem(this.resolveStateKey(), structuredClone(state))
    this.canonicalState = state
    this.fullReRender()
  }

  // ── Relation add (multi-field) ─────────────────────────────────────────

  private async handleAddRelation(): Promise<void> {
    if (!this.root) return
    const srcEl = this.root.querySelector('input[data-da-role="add-relation-source"]') as HTMLInputElement | null
    const labelEl = this.root.querySelector('input[data-da-role="add-relation-label"]') as HTMLInputElement | null
    const tgtEl = this.root.querySelector('input[data-da-role="add-relation-target"]') as HTMLInputElement | null
    if (!srcEl || !labelEl || !tgtEl) return

    const sourceId = srcEl.value.trim()
    const label = labelEl.value.trim()
    const targetId = tgtEl.value.trim()
    if (!sourceId || !label || !targetId) return

    if (this.store.writeCanonical) {
      const nextState = await this.store.writeCanonical((current) => {
        upsertRelation(current, { sourceId, label, targetId })
        return current
      })
      this.canonicalState = structuredClone(nextState)
      this.fullReRender()
      return
    }

    const state = await readCanonicalState(this.store)
    upsertRelation(state, { sourceId, label, targetId })
    await this.store.storage.setItem(this.resolveStateKey(), structuredClone(state))
    this.canonicalState = state
    this.fullReRender()
  }

  // ── Memory operations actions ──────────────────────────────────────

  private async handleForceExtract(): Promise<void> {
    if (!this.store.forceExtract) {
      this.showToast(t('toast.noCallback'), 'warning')
      return
    }
    try {
      await this.store.forceExtract()
    } catch (err) {
      this.showToast(t('toast.extractFailed', { error: String(err) }), 'error')
      return
    }
    this.showToast(t('toast.extractStarted'), 'info')
    await this.refreshMemoryOpsStatus()
    this.fullReRender()
  }

  private async handleForceDream(): Promise<void> {
    if (!this.store.forceDream) {
      this.showToast(t('toast.noCallback'), 'warning')
      return
    }
    try {
      await this.store.forceDream()
    } catch (err) {
      const msg = String(err)
      const blockedMatch = msg.match(/blocked:(\w+)/)
      if (blockedMatch && this.store.checkRefreshGuard) {
        this.showToast(guardReasonToast(blockedMatch[1] as BlockReason), 'warning')
        return
      }
      this.showToast(t('toast.dreamFailed', { error: msg }), 'error')
      return
    }
    this.showToast(t('toast.dreamStarted'), 'info')
    await this.refreshMemoryOpsStatus()
    this.fullReRender()
  }

  private async handleInspectRecalled(): Promise<void> {
    if (!this.store.getRecalledDocs) {
      this.showToast(t('toast.noCallback'), 'warning')
      return
    }
    const docs = await this.store.getRecalledDocs()
    this.memoryOpsStatus = {
      ...this.memoryOpsStatus,
      recalledDocs: docs.map((d) => ({
        id: d.id,
        title: d.title,
        freshness: d.freshness,
      })),
    }
    this.fullReRender()
  }

  private async handleToggleFallbackRetrieval(): Promise<void> {
    const next = !this.memoryOpsStatus.fallbackRetrievalEnabled
    this.memoryOpsStatus = {
      ...this.memoryOpsStatus,
      fallbackRetrievalEnabled: next,
    }
    await saveMemoryOpsPrefs(this.store.storage, {
      fallbackRetrievalEnabled: next,
    })
    this.showToast(t('toast.fallbackToggled'), 'info')
    this.fullReRender()
  }

  private async refreshMemoryOpsStatus(): Promise<void> {
    const dreamState = await loadDreamState(this.store.storage)
    const prefs = await loadMemoryOpsPrefs(this.store.storage)
    const canonicalState = await readCanonicalState(this.store)
    this.canonicalState = canonicalState
    const isLocked = this.store.isMemoryLocked
      ? await this.store.isMemoryLocked()
      : false
    const latestMemoryTs = computeLatestMemoryTs(canonicalState)
    const diagnostics = this.store.loadDiagnostics
      ? await this.store.loadDiagnostics()
      : createDefaultDiagnosticsSnapshot()

    this.memoryOpsStatus = {
      lastExtractTs: latestMemoryTs,
      lastDreamTs: dreamState.lastDreamTs,
      notebookFreshness: computeNotebookFreshness(latestMemoryTs, dreamState.lastDreamTs),
      documentCounts: computeDocumentCounts(canonicalState.memory),
      fallbackRetrievalEnabled: prefs.fallbackRetrievalEnabled,
      isMemoryLocked: isLocked,
      staleWarnings: buildStaleWarnings(latestMemoryTs, dreamState.lastDreamTs),
      recalledDocs: this.memoryOpsStatus.recalledDocs,
      diagnostics,
    }
  }

  // ── Language switch ──────────────────────────────────────────────────

  private async handleSwitchLang(btn: HTMLElement): Promise<void> {
    const nextLocale = (btn.getAttribute('data-da-lang') ?? 'en') as DashboardLocale
    setLocale(nextLocale)
    await this.store.storage.setItem(DASHBOARD_LOCALE_KEY, nextLocale)
    this.connectionStatus = { kind: this.connectionStatus.kind, message: this.localizedConnectionMessage() }
    this.fullReRender()
  }

  // ── Toast ─────────────────────────────────────────────────────────────

  private showToast(message: string, severity: ToastSeverity = 'info'): void {
    const prev = this.doc.querySelector('.da-toast')
    if (prev) prev.remove()

    const toast = this.doc.createElement('div')
    toast.className = `da-toast da-toast--${severity}`

    if (severity === 'error') {
      toast.setAttribute('role', 'alert')
      toast.setAttribute('aria-live', 'assertive')
    } else {
      toast.setAttribute('role', 'status')
      toast.setAttribute('aria-live', 'polite')
    }

    toast.textContent = message
    this.doc.body.appendChild(toast)

    const duration = severity === 'error' ? TOAST_DURATION_ERROR_MS : TOAST_DURATION_MS
    this.lifecycle.setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast)
    }, duration)
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isValidExportPayload(value: unknown): value is ProfileExportPayload {
  if (value == null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.schema === 'director-actor-dashboard-profile' &&
    typeof v.version === 'number' &&
    v.profile != null &&
    typeof v.profile === 'object' &&
    typeof (v.profile as Record<string, unknown>).id === 'string' &&
    typeof (v.profile as Record<string, unknown>).name === 'string'
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open the fullscreen dashboard.
 *
 * Calling this while a dashboard is already open tears down the
 * previous instance first (idempotent re-open).
 *
 * @param api       The RisuAI plugin API
 * @param store     A `DashboardStore` (use `createDashboardStore` to build one)
 * @param doc       Document to render into (defaults to `globalThis.document`)
 */
export async function openDashboard(
  api: RisuaiApi,
  store: DashboardStore,
  doc?: Document,
): Promise<void> {
  if (activeInstance) {
    await activeInstance.close()
  }

  const targetDoc = doc ?? globalThis.document

  // Defensive cleanup: remove any stale roots left by prior instances
  for (const el of Array.from(targetDoc.querySelectorAll(`.${DASHBOARD_ROOT_CLASS}`))) {
    el.remove()
  }

  // Load persisted state
  const rawLocale = await store.storage.getItem<string>(DASHBOARD_LOCALE_KEY)
  if (rawLocale === 'en' || rawLocale === 'ko') {
    setLocale(rawLocale as DashboardLocale)
  }

  const rawSettings = await store.storage.getItem<Partial<DirectorSettings>>(
    DASHBOARD_SETTINGS_KEY,
  )
  const settings = normalizePersistedSettings(rawSettings ?? {})
  const draft = createDashboardDraft(settings)

  const rawManifest = await store.storage.getItem<ProfileManifest>(
    DASHBOARD_PROFILE_MANIFEST_KEY,
  )
  const profiles = rawManifest ?? createDefaultProfileManifest()

  // Best-effort initial model load
  let modelOptions: string[] = [settings.directorModel]
  try {
    modelOptions = await loadProviderModels(api, settings)
    if (!modelOptions.includes(settings.directorModel)) {
      modelOptions.unshift(settings.directorModel)
    }
  } catch {
    // Non-fatal: show the current model only
  }

  // Load canonical memory state for the memory page
  const canonicalState = await readCanonicalState(store)

  // Build memory operations status for the memory page
  const memoryOpsStatus = await buildMemoryOpsStatus(store, canonicalState)

  const instance = new DashboardInstance(
    api,
    store,
    targetDoc,
    draft,
    profiles,
    modelOptions,
    canonicalState,
    memoryOpsStatus,
  )
  activeInstance = instance
  await instance.mount()
}

/**
 * Close the currently open dashboard (if any).
 * Safe to call when no dashboard is open.
 */
export async function closeDashboard(): Promise<void> {
  if (activeInstance) {
    await activeInstance.close()
  }
}
