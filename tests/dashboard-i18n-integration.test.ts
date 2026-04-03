/**
 * @vitest-environment jsdom
 */
import { beforeEach, afterEach } from 'vitest'
import { createMockRisuaiApi } from './helpers/mockRisuai.js'
import { openDashboard, closeDashboard } from '../src/ui/dashboardApp.js'
import type { DashboardStore } from '../src/ui/dashboardApp.js'
import { DASHBOARD_ROOT_CLASS } from '../src/ui/dashboardCss.js'
import { setLocale, getLocale, t } from '../src/ui/i18n.js'
import { DASHBOARD_LOCALE_KEY, DASHBOARD_SETTINGS_KEY } from '../src/ui/dashboardState.js'
import { DEFAULT_DIRECTOR_SETTINGS } from '../src/contracts/types.js'

function createTestStore(api: ReturnType<typeof createMockRisuaiApi>): DashboardStore {
  return { storage: api.pluginStorage }
}

describe('dashboard i18n integration', () => {
  let api: ReturnType<typeof createMockRisuaiApi>
  let store: DashboardStore

  beforeEach(() => {
    api = createMockRisuaiApi()
    store = createTestStore(api)
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    setLocale('en')
  })

  afterEach(async () => {
    await closeDashboard()
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    setLocale('en')
  })

  // ── Language selector visibility ───────────────────────────────────

  test('dashboard renders a language selector element', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const langSelector = root.querySelector('[data-da-action="switch-lang"]')
    expect(langSelector).not.toBeNull()
  })

  // ── Switching locale updates visible UI ────────────────────────────

  test('clicking language selector switches dashboard text to Korean', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    // Should initially show English title
    expect(root.innerHTML).toContain('Director Dashboard')

    // Click the language switch
    const langBtn = root.querySelector('[data-da-action="switch-lang"]') as HTMLElement
    expect(langBtn).not.toBeNull()
    langBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    // After switch, the dashboard should re-render with Korean text
    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    expect(updatedRoot.innerHTML).not.toContain('Director Dashboard')
    expect(getLocale()).toBe('ko')
  })

  test('switching back to English restores English text', async () => {
    setLocale('ko')
    await openDashboard(api, store)

    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const langBtn = root.querySelector('[data-da-action="switch-lang"]') as HTMLElement
    langBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    expect(updatedRoot.innerHTML).toContain('Director Dashboard')
    expect(getLocale()).toBe('en')
  })

  // ── Persistence ────────────────────────────────────────────────────

  test('locale selection persists to plugin storage', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const langBtn = root.querySelector('[data-da-action="switch-lang"]') as HTMLElement
    langBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const stored = await api.pluginStorage.getItem<string>(DASHBOARD_LOCALE_KEY)
    expect(stored).toBe('ko')
  })

  test('dashboard loads persisted locale on reopen', async () => {
    await api.pluginStorage.setItem(DASHBOARD_LOCALE_KEY, 'ko')
    await openDashboard(api, store)

    expect(getLocale()).toBe('ko')
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    // Should render in Korean (no "Director Dashboard" English text)
    expect(root.innerHTML).not.toContain('Director Dashboard')
  })

  test('persisted locale survives close and reopen', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const langBtn = root.querySelector('[data-da-action="switch-lang"]') as HTMLElement
    langBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    await closeDashboard()

    // Reopen
    await openDashboard(api, store)
    expect(getLocale()).toBe('ko')
    const newRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    expect(newRoot.innerHTML).not.toContain('Director Dashboard')
  })

  // ── Localized tab labels ───────────────────────────────────────────

  test('tab labels render in the active locale', async () => {
    setLocale('ko')
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    // Should not contain English tab labels
    expect(root.innerHTML).not.toContain('>General<')
  })

  // ── Connection status re-localization on locale switch ──────────────

  test('idle connection status re-localizes on locale switch', async () => {
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    // Initially English idle text
    const statusBefore = root.querySelector('.da-connection-status')
    expect(statusBefore?.textContent).toBe(t('connection.notTested'))

    // Switch to Korean
    const langBtn = root.querySelector('[data-da-action="switch-lang"]') as HTMLElement
    langBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const statusAfter = updatedRoot.querySelector('.da-connection-status')
    setLocale('ko')
    expect(statusAfter?.textContent).toBe(t('connection.notTested'))
  })

  test('ok connection status re-localizes on locale switch', async () => {
    await api.pluginStorage.setItem(DASHBOARD_SETTINGS_KEY, {
      ...DEFAULT_DIRECTOR_SETTINGS,
      directorApiKey: 'sk-test',
      directorBaseUrl: 'https://api.openai.com/v1',
    })
    // Initial model load + test-connection click
    api.enqueueNativeFetchJson({ data: [{ id: 'm1' }, { id: 'm2' }] })
    api.enqueueNativeFetchJson({ data: [{ id: 'm1' }, { id: 'm2' }] })

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    // Trigger connection test to set status to 'ok'
    const testBtn = root.querySelector('[data-da-action="test-connection"]') as HTMLElement
    testBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    // Status should be English 'ok'
    const statusEl = document.querySelector('.da-connection-status')
    expect(statusEl?.getAttribute('data-da-status')).toBe('ok')
    expect(statusEl?.textContent).toContain('2 models')

    // Switch to Korean
    const langBtn = document.querySelector('[data-da-action="switch-lang"]') as HTMLElement
    langBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const updatedStatus = document.querySelector('.da-connection-status')
    expect(updatedStatus?.getAttribute('data-da-status')).toBe('ok')
    // Should now contain Korean text, not stale English
    setLocale('ko')
    const expected = t('connection.connected', { count: '2' })
    expect(updatedStatus?.textContent).toBe(expected)
  })

  test('error connection status preserves raw error text on locale switch', async () => {
    await api.pluginStorage.setItem(DASHBOARD_SETTINGS_KEY, {
      ...DEFAULT_DIRECTOR_SETTINGS,
      directorApiKey: 'sk-bad',
      directorBaseUrl: 'https://api.openai.com/v1',
    })
    // Initial model load succeeds, test-connection fails
    api.enqueueNativeFetchJson({ data: [] })
    api.enqueueNativeFetchJson({ error: 'Unauthorized' }, { status: 401, ok: false })

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    const testBtn = root.querySelector('[data-da-action="test-connection"]') as HTMLElement
    testBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const statusEl = document.querySelector('.da-connection-status')
    expect(statusEl?.getAttribute('data-da-status')).toBe('error')
    const errorText = statusEl?.textContent ?? ''

    // Switch to Korean — error text should stay unchanged
    const langBtn = document.querySelector('[data-da-action="switch-lang"]') as HTMLElement
    langBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const updatedStatus = document.querySelector('.da-connection-status')
    expect(updatedStatus?.getAttribute('data-da-status')).toBe('error')
    expect(updatedStatus?.textContent).toBe(errorText)
  })
})
