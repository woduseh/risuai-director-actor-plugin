import { buildDashboardCss, DASHBOARD_ROOT_CLASS } from '../src/ui/dashboardCss.js'

describe('buildDashboardCss', () => {
  test('uses a stable namespace root class', () => {
    expect(DASHBOARD_ROOT_CLASS).toBe('da-root')
  })

  test('includes theme-aware CSS variables and key component selectors', () => {
    const css = buildDashboardCss()

    expect(css).toContain('--risu-theme-bgcolor')
    expect(css).toContain(`.${DASHBOARD_ROOT_CLASS}`)
    expect(css).toContain('.da-sidebar')
    expect(css).toContain('.da-card')
    expect(css).toContain('.da-toggle')
  })

  test('includes selectors required for dashboard integration', () => {
    const css = buildDashboardCss()
    const selectors = [
      '.da-dashboard',
      '.da-sidebar-header',
      '.da-kicker',
      '.da-title',
      '.da-subtitle',
      '.da-sidebar-nav',
      '.da-sidebar-btn',
      '.da-sidebar-btn--active',
      '.da-sidebar-footer',
      '.da-nav-group',
      '.da-nav-group-label',
      '.da-content',
      '.da-toolbar',
      '.da-toolbar-meta',
      '.da-toolbar-actions',
      '.da-page',
      '.da-page-title',
      '.da-page-section',
      '.da-hidden',
      '.da-grid',
      '.da-card-header',
      '.da-card-title',
      '.da-card-copy',
      '.da-form-grid',
      '.da-label',
      '.da-label-text',
      '.da-select',
      '.da-input',
      '.da-checkbox',
      '.da-btn',
      '.da-btn--primary',
      '.da-btn--ghost',
      '.da-btn--danger',
      '.da-badge',
      '.da-badge[data-kind="success"]',
      '.da-badge[data-kind="error"]',
      '.da-hint',
      '.da-inline',
      '.da-toggle',
      '.da-toggle-track',
      '.da-toggle-dot',
      '.da-connection-status',
      '.da-connection-status[data-da-status="ok"]',
      '.da-connection-status[data-da-status="error"]',
      '.da-connection-status[data-da-status="testing"]',
      '.da-connection-status[data-da-status="idle"]',
      '.da-connection-status[data-da-status="loading"]',
      '.da-connection-status[data-da-status="success"]',
      '.da-profile-list',
      '.da-profile-item',
      '.da-profile--active',
      '.da-metric-list',
      '.da-metric-item',
      '.da-split',
      '.da-close-btn',
      '.da-toast',
      '.da-footer',
      '.da-dirty-indicator',
    ]

    for (const selector of selectors) {
      expect(css).toContain(selector)
    }
  })
})
