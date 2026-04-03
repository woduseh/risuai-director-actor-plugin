/**
 * @vitest-environment jsdom
 */
import { beforeEach, afterEach } from 'vitest'
import { createMockRisuaiApi } from './helpers/mockRisuai.js'
import { openDashboard, closeDashboard } from '../src/ui/dashboardApp.js'
import type { DashboardStore } from '../src/ui/dashboardApp.js'
import { DASHBOARD_STYLE_ID, DASHBOARD_ROOT_CLASS } from '../src/ui/dashboardCss.js'
import { resolveScopeStorageKey } from '../src/memory/scopeResolver.js'
import {
  DASHBOARD_SETTINGS_KEY,
  DASHBOARD_PROFILE_MANIFEST_KEY,
  DASHBOARD_MEMORY_OPS_PREFS_KEY,
} from '../src/ui/dashboardState.js'
import { createEmptyState, DEFAULT_DIRECTOR_SETTINGS } from '../src/contracts/types.js'
import { BUILTIN_PROMPT_PRESET_ID } from '../src/director/prompt.js'

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

  test('loads persisted embedding settings into the model settings controls', async () => {
    await api.pluginStorage.setItem(DASHBOARD_SETTINGS_KEY, {
      ...DEFAULT_DIRECTOR_SETTINGS,
      embeddingsEnabled: true,
      embeddingProvider: 'voyageai',
      embeddingBaseUrl: 'https://api.voyageai.com/v1',
      embeddingApiKey: 'voyage-test-key',
      embeddingModel: 'voyage-3-lite',
      embeddingDimensions: 1024,
    })

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const modelBtn = root.querySelector('[data-da-target="model-settings"]') as HTMLElement
    modelBtn.click()

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const providerSelect = updatedRoot.querySelector(
      '[data-da-field="embeddingProvider"]',
    ) as HTMLSelectElement | null
    const baseUrlInput = updatedRoot.querySelector(
      '[data-da-field="embeddingBaseUrl"]',
    ) as HTMLInputElement | null
    const apiKeyInput = updatedRoot.querySelector(
      '[data-da-field="embeddingApiKey"]',
    ) as HTMLInputElement | null
    const modelInput = updatedRoot.querySelector(
      '[data-da-field="embeddingModel"]',
    ) as HTMLInputElement | HTMLSelectElement | null
    const dimensionsInput = updatedRoot.querySelector(
      '[data-da-field="embeddingDimensions"]',
    ) as HTMLInputElement | null

    expect(providerSelect).not.toBeNull()
    expect(providerSelect?.value).toBe('voyageai')
    expect(baseUrlInput?.value).toBe('https://api.voyageai.com/v1')
    expect(apiKeyInput?.value).toBe('voyage-test-key')
    expect(modelInput?.value).toBe('voyage-3-lite')
    expect(dimensionsInput?.value).toBe('1024')
  })

  test('changing embedding provider applies provider default base URL', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const modelBtn = root.querySelector('[data-da-target="model-settings"]') as HTMLElement
    modelBtn.click()

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const providerSelect = updatedRoot.querySelector(
      '[data-da-field="embeddingProvider"]',
    ) as HTMLSelectElement
    const baseUrlInput = updatedRoot.querySelector(
      '[data-da-field="embeddingBaseUrl"]',
    ) as HTMLInputElement

    providerSelect.value = 'voyageai'
    providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
    expect(baseUrlInput.value).toBe('https://api.voyageai.com/v1')

    providerSelect.value = 'custom'
    providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
    expect(baseUrlInput.value).toBe('')
  })

  test('opening the dashboard with a copilot provider loads curated model options without an API key', async () => {
    await api.pluginStorage.setItem(DASHBOARD_SETTINGS_KEY, {
      ...DEFAULT_DIRECTOR_SETTINGS,
      directorProvider: 'copilot',
      directorApiKey: '',
      directorBaseUrl: 'https://api.githubcopilot.com/v1',
      directorModel: 'gpt-5.4',
    })

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const modelBtn = root.querySelector('[data-da-target="model-settings"]') as HTMLElement
    modelBtn.click()

    const modelSelect = document.querySelector(
      '[data-da-field="directorModel"]',
    ) as HTMLSelectElement
    const values = Array.from(modelSelect.options).map((option) => option.value)

    expect(values).toContain('gpt-5.4')
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

  test('refresh-models reloads the provider model list into the selector', async () => {
    await api.pluginStorage.setItem(DASHBOARD_SETTINGS_KEY, {
      ...DEFAULT_DIRECTOR_SETTINGS,
      directorApiKey: 'sk-test',
      directorBaseUrl: 'https://api.openai.com/v1',
      directorModel: 'gpt-5.4',
    })
    api.enqueueNativeFetchJson({
      data: [{ id: 'gpt-5.4' }],
    })
    api.enqueueNativeFetchJson({
      data: [{ id: 'gpt-5.4-pro' }, { id: 'gpt-5.4' }],
    })

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const refreshBtn = root.querySelector('[data-da-action="refresh-models"]') as HTMLElement
    expect(refreshBtn).not.toBeNull()
    refreshBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const modelSelect = document.querySelector(
      '[data-da-field="directorModel"]',
    ) as HTMLSelectElement
    const values = Array.from(modelSelect.options).map((option) => option.value)
    expect(values).toEqual(expect.arrayContaining(['gpt-5.4', 'gpt-5.4-pro']))
  })

  test('test-connection escapes returned model option ids when updating the select', async () => {
    const injectedModel = 'gpt-bad" data-evil="1'

    await api.pluginStorage.setItem(DASHBOARD_SETTINGS_KEY, {
      ...DEFAULT_DIRECTOR_SETTINGS,
      directorApiKey: 'sk-test',
      directorBaseUrl: 'https://api.openai.com/v1',
    })
    api.enqueueNativeFetchJson({
      data: [{ id: 'gpt-4.1-mini' }],
    })
    api.enqueueNativeFetchJson({
      data: [{ id: injectedModel }],
    })

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const testBtn = root.querySelector('[data-da-action="test-connection"]') as HTMLElement
    testBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const select = document.querySelector(
      'select[data-da-field="directorModel"]',
    ) as HTMLSelectElement
    const injectedOption = Array.from(select.options).find(
      (option) => option.value === injectedModel,
    )

    expect(injectedOption).toBeDefined()
    expect(select.querySelector('[data-evil="1"]')).toBeNull()
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

  test('create-prompt-preset clones the current preset and saves edited templates', async () => {
    await openDashboard(api, store)
    let root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const promptTabBtn = root.querySelector('[data-da-target="prompt-tuning"]') as HTMLElement
    promptTabBtn.click()

    const createBtn = root.querySelector('[data-da-action="create-prompt-preset"]') as HTMLElement
    expect(createBtn).not.toBeNull()
    createBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const presetSelect = root.querySelector('[data-da-role="prompt-preset-select"]') as HTMLSelectElement
    const presetName = root.querySelector('[data-da-role="prompt-preset-name"]') as HTMLInputElement
    const systemTemplate = root.querySelector('[data-da-role="prompt-pre-request-system"]') as HTMLTextAreaElement

    expect(presetSelect.value).not.toBe(BUILTIN_PROMPT_PRESET_ID)
    expect(presetName.value).toBeTruthy()

    systemTemplate.value = 'Custom preset system template'
    systemTemplate.dispatchEvent(new Event('input', { bubbles: true }))

    const saveBtn = root.querySelector('[data-da-action="save"]') as HTMLElement
    saveBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const stored = await api.pluginStorage.getItem<{
      promptPresetId: string
      promptPresets: Record<string, { preset: { preRequestSystemTemplate: string } }>
    }>(DASHBOARD_SETTINGS_KEY)
    expect(stored).not.toBeNull()
    expect(stored?.promptPresetId).not.toBe(BUILTIN_PROMPT_PRESET_ID)
    expect(
      Object.values(stored?.promptPresets ?? {}).some(
        (entry) => entry.preset.preRequestSystemTemplate === 'Custom preset system template',
      ),
    ).toBe(true)
  })

  test('backfill-current-chat extracts memories from the active chat into the dashboard state', async () => {
    const host = api as unknown as Record<string, unknown>
    host.getCharacter = async () => ({ chaId: 'cha-1', name: 'Hero' })
    host.getCurrentCharacterIndex = async () => 0
    host.getCurrentChatIndex = async () => 0
    host.getChatFromIndex = async () => ({
      id: 'chat-1',
      name: 'Session 1',
      lastDate: 1,
      messages: [
        { role: 'user', content: 'Where is the key?' },
        { role: 'assistant', content: 'A hides the key under the altar.' },
      ],
    })

    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        status: 'pass',
        turnScore: 0.8,
        violations: [],
        durableFacts: ['The key is hidden under the altar.'],
        sceneDelta: { scenePhase: 'turn', activeCharacters: ['A'] },
        entityUpdates: [],
        relationUpdates: [],
        memoryOps: [],
      }),
    })

    const scopeKey = (await resolveScopeStorageKey(api)).storageKey
    store = { storage: api.pluginStorage, stateStorageKey: scopeKey }

    await openDashboard(api, store)
    let root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const memoryTabBtn = root.querySelector('[data-da-target="memory-cache"]') as HTMLElement
    memoryTabBtn.click()

    const backfillBtn = root.querySelector('[data-da-action="backfill-current-chat"]') as HTMLElement
    expect(backfillBtn).not.toBeNull()
    backfillBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = root.querySelector('#da-page-memory-cache') as HTMLElement
    expect(memoryPage.textContent).toContain('The key is hidden under the altar.')
  })

  test('regenerate-current-chat replaces existing scoped memory with freshly extracted memory', async () => {
    const host = api as unknown as Record<string, unknown>
    host.getCharacter = async () => ({ chaId: 'cha-1', name: 'Hero' })
    host.getCurrentCharacterIndex = async () => 0
    host.getCurrentChatIndex = async () => 0
    host.getChatFromIndex = async () => ({
      id: 'chat-1',
      name: 'Session 1',
      lastDate: 1,
      messages: [
        { role: 'user', content: 'Where is the key?' },
        { role: 'assistant', content: 'A hides the key under the altar.' },
      ],
    })

    const seededState = createEmptyState()
    seededState.memory.summaries.push({
      id: 'old-summary',
      text: 'Outdated memory',
      recencyWeight: 0.2,
      updatedAt: 1,
    })
    const scopeKey = (await resolveScopeStorageKey(api)).storageKey
    store = { storage: api.pluginStorage, stateStorageKey: scopeKey }
    await api.pluginStorage.setItem(scopeKey, seededState)

    api.enqueueLlmResult({
      type: 'success',
      result: JSON.stringify({
        status: 'pass',
        turnScore: 0.8,
        violations: [],
        durableFacts: ['The key is hidden under the altar.'],
        sceneDelta: { scenePhase: 'turn', activeCharacters: ['A'] },
        entityUpdates: [],
        relationUpdates: [],
        memoryOps: [],
      }),
    })

    await openDashboard(api, store)
    let root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const memoryTabBtn = root.querySelector('[data-da-target="memory-cache"]') as HTMLElement
    memoryTabBtn.click()

    const regenerateBtn = root.querySelector('[data-da-action="regenerate-current-chat"]') as HTMLElement
    expect(regenerateBtn).not.toBeNull()
    regenerateBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = root.querySelector('#da-page-memory-cache') as HTMLElement
    expect(memoryPage.textContent).toContain('The key is hidden under the altar.')
    expect(memoryPage.textContent).not.toContain('Outdated memory')
  })

  // ── Memory Operations: Status card, force actions, fallback toggle ──

  test('renders memory ops status card on the memory page', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const memoryTabBtn = root.querySelector('[data-da-target="memory-cache"]') as HTMLElement
    memoryTabBtn.click()

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const statusCard = updatedRoot.querySelector('[data-da-role="memory-ops-status"]')
    expect(statusCard).not.toBeNull()
    expect(statusCard?.textContent).toContain('Summaries')
  })

  test('force-extract calls store.forceExtract callback', async () => {
    let extractCalled = false
    const storeWithOps: DashboardStore = {
      storage: api.pluginStorage,
      forceExtract: async () => { extractCalled = true },
    }

    await openDashboard(api, storeWithOps)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const memoryTabBtn = root.querySelector('[data-da-target="memory-cache"]') as HTMLElement
    memoryTabBtn.click()

    const extractBtn = root.querySelector('[data-da-action="force-extract"]') as HTMLElement
    expect(extractBtn).not.toBeNull()
    extractBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    expect(extractCalled).toBe(true)
  })

  test('force-dream calls store.forceDream callback', async () => {
    let dreamCalled = false
    const storeWithOps: DashboardStore = {
      storage: api.pluginStorage,
      forceDream: async () => { dreamCalled = true },
    }

    await openDashboard(api, storeWithOps)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const memoryTabBtn = root.querySelector('[data-da-target="memory-cache"]') as HTMLElement
    memoryTabBtn.click()

    const dreamBtn = root.querySelector('[data-da-action="force-dream"]') as HTMLElement
    expect(dreamBtn).not.toBeNull()
    dreamBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    expect(dreamCalled).toBe(true)
  })

  test('force-extract shows error toast when callback throws', async () => {
    const storeWithOps: DashboardStore = {
      storage: api.pluginStorage,
      forceExtract: async () => { throw new Error('extract-boom') },
    }

    await openDashboard(api, storeWithOps)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const memoryTabBtn = root.querySelector('[data-da-target="memory-cache"]') as HTMLElement
    memoryTabBtn.click()

    const extractBtn = root.querySelector('[data-da-action="force-extract"]') as HTMLElement
    extractBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const toast = document.querySelector('.da-toast')
    expect(toast).not.toBeNull()
    expect(toast!.textContent).toContain('extract-boom')
  })

  test('force-dream shows error toast when callback throws', async () => {
    const storeWithOps: DashboardStore = {
      storage: api.pluginStorage,
      forceDream: async () => { throw new Error('dream-boom') },
    }

    await openDashboard(api, storeWithOps)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const memoryTabBtn = root.querySelector('[data-da-target="memory-cache"]') as HTMLElement
    memoryTabBtn.click()

    const dreamBtn = root.querySelector('[data-da-action="force-dream"]') as HTMLElement
    dreamBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const toast = document.querySelector('.da-toast')
    expect(toast).not.toBeNull()
    expect(toast!.textContent).toContain('dream-boom')
  })

  test('toggle-fallback-retrieval persists mode and re-renders', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const memoryTabBtn = root.querySelector('[data-da-target="memory-cache"]') as HTMLElement
    memoryTabBtn.click()

    const toggleBtn = root.querySelector('[data-da-action="toggle-fallback-retrieval"]') as HTMLElement
    expect(toggleBtn).not.toBeNull()
    toggleBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const stored = await api.pluginStorage.getItem<{ fallbackRetrievalEnabled: boolean }>(
      DASHBOARD_MEMORY_OPS_PREFS_KEY,
    )
    expect(stored).not.toBeNull()
    expect(stored!.fallbackRetrievalEnabled).toBe(true)
  })
})
