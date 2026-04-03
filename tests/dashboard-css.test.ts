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

  // ── UI-1: Unstyled DOM classes ──────────────────────────────────────

  test('includes styles for diagnostic/warning/recalled/breadcrumb DOM classes', () => {
    const css = buildDashboardCss()
    const selectors = [
      '.da-warning',
      '.da-warning-list',
      '.da-warning-item',
      '.da-recalled-list',
      '.da-recalled-item',
      '.da-breadcrumb-list',
      '.da-breadcrumb-item',
      '.da-badge--sm',
      '.da-diag-section',
    ]

    for (const selector of selectors) {
      expect(css).toContain(selector)
    }
  })

  // ── UI-1: Disabled form controls ────────────────────────────────────

  test('includes disabled styling for buttons and form controls', () => {
    const css = buildDashboardCss()
    expect(css).toContain('.da-btn:disabled')
    expect(css).toContain('.da-input:disabled')
    expect(css).toContain('.da-select:disabled')
    expect(css).toContain('.da-textarea:disabled')
  })

  // ── UI-1: Focus-visible on toggle ───────────────────────────────────

  test('includes :focus-visible styling for toggle controls', () => {
    const css = buildDashboardCss()
    expect(css).toContain('.da-toggle')
    expect(css).toContain('focus-visible')
    // Toggle should have a visible focus ring
    expect(css).toMatch(/\.da-toggle.*focus-visible/)
  })

  // ── UI-1: Toast severity variants ───────────────────────────────────

  test('includes toast severity variant CSS', () => {
    const css = buildDashboardCss()
    expect(css).toContain('.da-toast--success')
    expect(css).toContain('.da-toast--info')
    expect(css).toContain('.da-toast--warning')
    expect(css).toContain('.da-toast--error')
  })

  // ── Toast gradient opacity regression ─────────────────────────────

  test('toast gradient color-mix top stops sum to 100% (no unintended transparency)', () => {
    const css = buildDashboardCss()
    // Extract all color-mix() calls from toast rules
    const toastSection = css.slice(css.indexOf('.da-toast'))
    const colorMixPattern = /color-mix\(in srgb,\s*[^)]+?(\d+)%,\s*(?:white|black)\s+(\d+)%\)/g
    let match: RegExpExecArray | null
    const results: Array<{ full: string; sum: number }> = []
    while ((match = colorMixPattern.exec(toastSection)) !== null) {
      const sum = Number(match[1]) + Number(match[2])
      results.push({ full: match[0], sum })
    }
    expect(results.length).toBeGreaterThan(0)
    for (const { full, sum } of results) {
      expect(sum, `${full} sums to ${sum}%, expected 100%`).toBe(100)
    }
  })
})
