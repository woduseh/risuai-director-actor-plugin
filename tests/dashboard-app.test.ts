/**
 * @vitest-environment jsdom
 */
import { beforeEach, afterEach } from 'vitest'
import { createMockRisuaiApi } from './helpers/mockRisuai.js'
import { openDashboard, closeDashboard } from '../src/ui/dashboardApp.js'
import type { DashboardStore } from '../src/ui/dashboardApp.js'
import { DASHBOARD_STYLE_ID, DASHBOARD_ROOT_CLASS } from '../src/ui/dashboardCss.js'
import {
  DASHBOARD_SETTINGS_KEY,
  DASHBOARD_PROFILE_MANIFEST_KEY,
} from '../src/ui/dashboardState.js'
import { DEFAULT_DIRECTOR_SETTINGS } from '../src/contracts/types.js'

function createTestStore(api: ReturnType<typeof createMockRisuaiApi>): DashboardStore {
  return { storage: api.pluginStorage }
}

describe('openDashboard', () => {
  let api: ReturnType<typeof createMockRisuaiApi>
  let store: DashboardStore

  beforeEach(() => {
    api = createMockRisuaiApi()
    store = createTestStore(api)
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  afterEach(async () => {
    await closeDashboard()
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  // ── Requirement 1: Opens via showContainer('fullscreen') ────────────

  test('calls api.showContainer("fullscreen") on open', async () => {
    await openDashboard(api, store)
    expect(api.__containerVisible).toBe(true)
  })

  // ── Requirement 2: Injects namespaced CSS ───────────────────────────

  test('injects a <style> element with dashboard CSS into the document head', async () => {
    await openDashboard(api, store)
    const style = document.getElementById(DASHBOARD_STYLE_ID)
    expect(style).not.toBeNull()
    expect(style?.tagName.toLowerCase()).toBe('style')
    expect(style?.textContent).toContain(`.${DASHBOARD_ROOT_CLASS}`)
    expect(style?.textContent).toContain('.da-sidebar')
  })

  // ── Requirement 3: Renders dashboard markup ─────────────────────────

  test('renders the dashboard root and sidebar into the document body', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`)
    expect(root).not.toBeNull()
    expect(root?.querySelector('.da-sidebar')).not.toBeNull()
    expect(root?.querySelector('.da-content')).not.toBeNull()
    expect(root?.innerHTML).toContain('Director Dashboard')
  })

  test('renders the general page content by default', async () => {
    await openDashboard(api, store)
    const generalPage = document.querySelector('#da-page-general')
    expect(generalPage).not.toBeNull()
    expect(generalPage?.classList.contains('da-hidden')).toBe(false)
  })

  // ── Requirement 4: Sidebar tab switching ────────────────────────────

  test('switches visible page when a sidebar tab button is clicked', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const modelBtn = root.querySelector('[data-da-target="model-settings"]') as HTMLElement
    expect(modelBtn).not.toBeNull()
    modelBtn.click()

    const generalPage = document.querySelector('#da-page-general')
    const modelPage = document.querySelector('#da-page-model-settings')

    expect(generalPage?.classList.contains('da-hidden')).toBe(true)
    expect(modelPage?.classList.contains('da-hidden')).toBe(false)
  })

  test('updates sidebar button active class on tab switch', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const modelBtn = root.querySelector('[data-da-target="model-settings"]') as HTMLElement
    modelBtn.click()

    expect(modelBtn.classList.contains('da-sidebar-btn--active')).toBe(true)

    const generalBtn = root.querySelector('[data-da-target="general"]') as HTMLElement
    expect(generalBtn.classList.contains('da-sidebar-btn--active')).toBe(false)
  })

  // ── Requirement 5: Form controls bind to in-memory draft ───────────

  test('changing a select field updates the draft and marks dirty', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const select = root.querySelector('[data-da-field="assertiveness"]') as HTMLSelectElement
    expect(select).not.toBeNull()

    select.value = 'firm'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    const dirtyIndicator = root.querySelector('[data-da-role="dirty"]')
    expect(dirtyIndicator?.classList.contains('da-hidden')).toBe(false)
  })

  test('changing a checkbox field toggles the boolean value', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const checkbox = root.querySelector('[data-da-field="enabled"]') as HTMLInputElement
    expect(checkbox).not.toBeNull()

    checkbox.checked = false
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))

    const dirtyIndicator = root.querySelector('[data-da-role="dirty"]')
    expect(dirtyIndicator?.classList.contains('da-hidden')).toBe(false)
  })

  // ── Requirement 6: Load/save settings from pluginStorage ────────────

  test('loads previously persisted settings from storage', async () => {
    await api.pluginStorage.setItem(DASHBOARD_SETTINGS_KEY, {
      ...DEFAULT_DIRECTOR_SETTINGS,
      assertiveness: 'firm',
      briefTokenCap: 500,
    })

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const select = root.querySelector('[data-da-field="assertiveness"]') as HTMLSelectElement
    expect(select.value).toBe('firm')

    const capInput = root.querySelector('[data-da-field="briefTokenCap"]') as HTMLInputElement
    expect(capInput.value).toBe('500')
  })

  test('save persists draft to pluginStorage', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const select = root.querySelector('[data-da-field="assertiveness"]') as HTMLSelectElement
    select.value = 'firm'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    const saveBtn = root.querySelector('[data-da-action="save"]') as HTMLElement
    expect(saveBtn).not.toBeNull()
    saveBtn.click()

    await new Promise((r) => { setTimeout(r, 50) })

    const stored = await api.pluginStorage.getItem<Record<string, unknown>>(DASHBOARD_SETTINGS_KEY)
    expect(stored).not.toBeNull()
    expect((stored as { assertiveness: string }).assertiveness).toBe('firm')
  })

  test('save mirrors settings to canonical store when mirrorToCanonical is provided', async () => {
    let mirrored: unknown = null
    const storeWithMirror: DashboardStore = {
      storage: api.pluginStorage,
      mirrorToCanonical: async (settings) => {
        mirrored = settings
      },
    }

    await openDashboard(api, storeWithMirror)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const select = root.querySelector('[data-da-field="assertiveness"]') as HTMLSelectElement
    select.value = 'light'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    const saveBtn = root.querySelector('[data-da-action="save"]') as HTMLElement
    saveBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    expect(mirrored).not.toBeNull()
    expect((mirrored as { assertiveness: string }).assertiveness).toBe('light')
  })

  // ── Requirement 7: Profile create/select ────────────────────────────

  test('create-profile adds a new profile and persists manifest', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    // Switch to profiles tab
    const profileTabBtn = root.querySelector('[data-da-target="settings-profiles"]') as HTMLElement
    profileTabBtn.click()

    const createBtn = root.querySelector('[data-da-action="create-profile"]') as HTMLElement
    expect(createBtn).not.toBeNull()
    createBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const manifest = await api.pluginStorage.getItem<{ profiles: unknown[] }>(
      DASHBOARD_PROFILE_MANIFEST_KEY,
    )
    expect(manifest).not.toBeNull()
    expect(manifest!.profiles.length).toBeGreaterThanOrEqual(4)
  })

  test('clicking a profile item selects it as active', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    // Switch to profiles tab
    const profileTabBtn = root.querySelector('[data-da-target="settings-profiles"]') as HTMLElement
    profileTabBtn.click()

    const items = root.querySelectorAll('.da-profile-item')
    expect(items.length).toBeGreaterThanOrEqual(3)

    const gentleItem = Array.from(items).find(
      (el) => el.getAttribute('data-da-profile-id') === 'builtin-gentle',
    ) as HTMLElement | undefined
    expect(gentleItem).not.toBeUndefined()
    gentleItem!.click()

    // After re-render, the root may be replaced — re-query
    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    // Switch back to general tab to see the settings
    const generalBtn = updatedRoot.querySelector('[data-da-target="general"]') as HTMLElement
    generalBtn.click()

    const select = updatedRoot.querySelector('[data-da-field="assertiveness"]') as HTMLSelectElement
    expect(select.value).toBe('light')
  })

  // ── Requirement 8: Connection test ──────────────────────────────────

  test('test-connection calls testDirectorConnection and updates status', async () => {
    await api.pluginStorage.setItem(DASHBOARD_SETTINGS_KEY, {
      ...DEFAULT_DIRECTOR_SETTINGS,
      directorApiKey: 'sk-test',
      directorBaseUrl: 'https://api.openai.com/v1',
    })
    // First response consumed by initial model load during openDashboard
    api.enqueueNativeFetchJson({
      data: [{ id: 'gpt-4.1-mini' }, { id: 'gpt-4.1' }],
    })
    // Second response consumed by the test-connection click
    api.enqueueNativeFetchJson({
      data: [{ id: 'gpt-4.1-mini' }, { id: 'gpt-4.1' }],
    })

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const testBtn = root.querySelector('[data-da-action="test-connection"]') as HTMLElement
    expect(testBtn).not.toBeNull()
    testBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const status = document.querySelector('.da-connection-status')
    expect(status?.getAttribute('data-da-status')).toBe('ok')
    expect(status?.textContent).toContain('2 models')
  })

  // ── Requirement 9: Cleanup on close ─────────────────────────────────

  test('close removes the root element and hides the container', async () => {
    await openDashboard(api, store)
    expect(document.querySelector(`.${DASHBOARD_ROOT_CLASS}`)).not.toBeNull()

    await closeDashboard()

    expect(document.querySelector(`.${DASHBOARD_ROOT_CLASS}`)).toBeNull()
    expect(api.__containerVisible).toBe(false)
  })

  test('close removes the injected style element', async () => {
    await openDashboard(api, store)
    expect(document.getElementById(DASHBOARD_STYLE_ID)).not.toBeNull()

    await closeDashboard()

    expect(document.getElementById(DASHBOARD_STYLE_ID)).toBeNull()
  })

  test('repeated open calls teardown previous instance', async () => {
    await openDashboard(api, store)
    expect(document.querySelector(`.${DASHBOARD_ROOT_CLASS}`)).not.toBeNull()

    await openDashboard(api, store)
    const roots = document.querySelectorAll(`.${DASHBOARD_ROOT_CLASS}`)
    expect(roots.length).toBe(1)
  })

  test('close button triggers cleanup', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const closeBtn = root.querySelector('[data-da-action="close"]') as HTMLElement
    expect(closeBtn).not.toBeNull()
    closeBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    expect(document.querySelector(`.${DASHBOARD_ROOT_CLASS}`)).toBeNull()
    expect(api.__containerVisible).toBe(false)
  })

  // ── Requirement 6 continued: discard resets to persisted ────────────

  test('discard restores settings from storage and re-renders', async () => {
    await api.pluginStorage.setItem(DASHBOARD_SETTINGS_KEY, {
      ...DEFAULT_DIRECTOR_SETTINGS,
      assertiveness: 'standard',
    })

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const select = root.querySelector('[data-da-field="assertiveness"]') as HTMLSelectElement
    select.value = 'firm'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    const discardBtn = root.querySelector('[data-da-action="discard"]') as HTMLElement
    discardBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const updatedSelect = updatedRoot.querySelector('[data-da-field="assertiveness"]') as HTMLSelectElement
    expect(updatedSelect.value).toBe('standard')
  })

  // ── Export profile ──────────────────────────────────────────────────

  test('export-profile shows profile JSON via api.alert', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    // Switch to profiles tab
    const profileTabBtn = root.querySelector('[data-da-target="settings-profiles"]') as HTMLElement
    profileTabBtn.click()

    const exportBtn = root.querySelector('[data-da-action="export-profile"]') as HTMLElement
    expect(exportBtn).not.toBeNull()
    exportBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    expect(api.__alerts.length).toBeGreaterThanOrEqual(1)
    const alertText = api.__alerts[api.__alerts.length - 1]!
    expect(alertText).toContain('director-actor-dashboard-profile')
  })

  // ── Import profile via staging key ──────────────────────────────────

  test('import-profile imports from staging storage key', async () => {
    const importPayload = JSON.stringify({
      schema: 'director-actor-dashboard-profile',
      version: 1,
      profile: {
        id: 'imported-1',
        name: 'Imported Test',
        createdAt: 1000,
        updatedAt: 1000,
        basedOn: null,
        overrides: { assertiveness: 'firm' },
      },
    })
    await api.pluginStorage.setItem('dashboard-profile-import-staging', importPayload)

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    // Switch to profiles tab
    const profileTabBtn = root.querySelector('[data-da-target="settings-profiles"]') as HTMLElement
    profileTabBtn.click()

    const importBtn = root.querySelector('[data-da-action="import-profile"]') as HTMLElement
    expect(importBtn).not.toBeNull()
    importBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const manifest = await api.pluginStorage.getItem<{ profiles: Array<{ name: string }> }>(
      DASHBOARD_PROFILE_MANIFEST_KEY,
    )
    expect(manifest).not.toBeNull()
    expect(manifest!.profiles.some((p) => p.name === 'Imported Test')).toBe(true)

    const staging = await api.pluginStorage.getItem('dashboard-profile-import-staging')
    expect(staging).toBeNull()
  })
})
