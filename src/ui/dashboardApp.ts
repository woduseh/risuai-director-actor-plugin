import type { RisuaiApi, AsyncKeyValueStore } from '../contracts/risuai.js'
import type { DirectorSettings, DirectorPluginState } from '../contracts/types.js'
import { DEFAULT_DIRECTOR_SETTINGS } from '../contracts/types.js'
import { buildDashboardCss, DASHBOARD_STYLE_ID, DASHBOARD_ROOT_CLASS } from './dashboardCss.js'
import { buildDashboardMarkup, DASHBOARD_TABS } from './dashboardDom.js'
import type { DashboardMarkupInput } from './dashboardDom.js'
import { DashboardLifecycle } from './dashboardLifecycle.js'
import {
  DASHBOARD_SETTINGS_KEY,
  DASHBOARD_PROFILE_MANIFEST_KEY,
  DASHBOARD_LOCALE_KEY,
  createDashboardDraft,
  createDefaultProfileManifest,
  normalizePersistedSettings,
  mergeDashboardSettingsIntoPluginState,
  createProfileExportPayload,
} from './dashboardState.js'
import type {
  DashboardDraft,
  DashboardProfile,
  ProfileManifest,
  ProfileExportPayload,
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOAST_DURATION_MS = 2500
const PROFILE_ID_PREFIX = 'user-profile-'
const IMPORT_STAGING_KEY = 'dashboard-profile-import-staging'

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
  mirrorToCanonical?: (settings: DirectorSettings) => Promise<void>
}

/**
 * Build a `DashboardStore` from the api's pluginStorage.
 * If a CanonicalStore-compatible `writeFirst` is available, mirror saved
 * settings into the canonical plugin state.
 */
export function createDashboardStore(
  api: RisuaiApi,
  canonicalWriteFirst?: (
    mutator: (s: DirectorPluginState) => DirectorPluginState,
  ) => Promise<DirectorPluginState>,
): DashboardStore {
  const store: DashboardStore = {
    storage: api.pluginStorage,
  }
  if (canonicalWriteFirst) {
    store.mirrorToCanonical = async (settings) => {
      await canonicalWriteFirst((s) =>
        mergeDashboardSettingsIntoPluginState(s, settings),
      )
    }
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

  constructor(
    api: RisuaiApi,
    store: DashboardStore,
    doc: Document,
    draft: DashboardDraft,
    profiles: ProfileManifest,
    modelOptions: string[],
  ) {
    this.api = api
    this.store = store
    this.doc = doc
    this.draft = draft
    this.profiles = profiles
    this.activeTab = DASHBOARD_TABS[0]?.id ?? 'general'
    this.modelOptions = modelOptions
    this.connectionStatus = { kind: 'idle', message: t('connection.notTested') }
  }

  // ── public ────────────────────────────────────────────────────────────

  async mount(): Promise<void> {
    this.injectCss()
    this.renderRoot()
    this.bindEvents()
    await this.api.showContainer('fullscreen')
  }

  async close(): Promise<void> {
    this.lifecycle.teardown()
    this.removeDom()
    await this.api.hideContainer()
    if (activeInstance === this) activeInstance = null
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
      pluginState: createShellPluginState(this.draft.settings),
      profiles: this.profiles,
      activeTab: this.activeTab,
      modelOptions: this.modelOptions,
      connectionStatus: this.connectionStatus,
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
          `<option value="${m}"${m === this.draft.settings.directorModel ? ' selected' : ''}>${m}</option>`,
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
      this.handleFieldChange(e.target as HTMLElement)
    })

    this.lifecycle.listen(this.root, 'input', (e) => {
      const el = e.target as HTMLElement
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

    switch (action) {
      case 'close':
        await this.close()
        break
      case 'save':
        await this.handleSave()
        break
      case 'discard':
        await this.handleDiscard()
        break
      case 'test-connection':
        await this.handleTestConnection()
        break
      case 'create-profile':
        await this.handleCreateProfile()
        break
      case 'export-profile':
        await this.handleExportProfile()
        break
      case 'import-profile':
        await this.handleImportProfile()
        break
      case 'switch-lang':
        await this.handleSwitchLang(btn)
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
      this.draft.isDirty = true
      this.updateDirtyIndicator()
    }

    // Provider change → apply base URL defaults
    if (key === 'directorProvider') {
      const providerDefaults = resolveProviderDefaults(
        value as DirectorSettings['directorProvider'],
      )
      this.draft.settings.directorBaseUrl = providerDefaults.baseUrl
      this.draft.isDirty = true

      const baseUrlInput = this.root?.querySelector(
        '[data-da-field="directorBaseUrl"]',
      ) as HTMLInputElement | null
      if (baseUrlInput) {
        baseUrlInput.value = providerDefaults.baseUrl
      }
    }

    if (key === 'embeddingProvider') {
      const providerDefaults = resolveEmbeddingDefaults(
        value as DirectorSettings['embeddingProvider'],
      )
      this.draft.settings.embeddingBaseUrl = providerDefaults.baseUrl
      this.draft.isDirty = true

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
    this.showToast(t('toast.settingsSaved'))
  }

  private async handleDiscard(): Promise<void> {
    const raw = await this.store.storage.getItem<Partial<DirectorSettings>>(
      DASHBOARD_SETTINGS_KEY,
    )
    this.draft = createDashboardDraft(
      normalizePersistedSettings(raw ?? {}),
    )
    this.fullReRender()
    this.showToast(t('toast.changesDiscarded'))
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
    this.showToast(t('toast.profileCreated'))
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
      this.showToast(t('toast.noProfileSelected'))
      return
    }
    const payload = createProfileExportPayload(activeProfile)
    const json = JSON.stringify(payload, null, 2)
    await this.api.alert(json)
    this.showToast(t('toast.profileExported'))
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
      this.showToast(t('toast.profileImported'))
    } catch {
      await this.api.alertError(t('toast.failedParseProfile'))
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

  private showToast(message: string): void {
    const prev = this.doc.querySelector('.da-toast')
    if (prev) prev.remove()

    const toast = this.doc.createElement('div')
    toast.className = 'da-toast'
    toast.textContent = message
    this.doc.body.appendChild(toast)

    this.lifecycle.setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast)
    }, TOAST_DURATION_MS)
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
    if (settings.directorApiKey) {
      modelOptions = await loadProviderModels(api, settings)
      if (!modelOptions.includes(settings.directorModel)) {
        modelOptions.unshift(settings.directorModel)
      }
    }
  } catch {
    // Non-fatal: show the current model only
  }

  const instance = new DashboardInstance(
    api,
    store,
    targetDoc,
    draft,
    profiles,
    modelOptions,
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
