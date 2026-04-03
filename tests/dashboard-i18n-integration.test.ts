/**
 * @vitest-environment jsdom
 */
import { beforeEach, afterEach } from 'vitest'
import { createMockRisuaiApi } from './helpers/mockRisuai.js'
import { openDashboard, closeDashboard } from '../src/ui/dashboardApp.js'
import type { DashboardStore } from '../src/ui/dashboardApp.js'
import { DASHBOARD_ROOT_CLASS } from '../src/ui/dashboardCss.js'
import { setLocale, getLocale } from '../src/ui/i18n.js'
import { DASHBOARD_LOCALE_KEY } from '../src/ui/dashboardState.js'

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
})
