import { buildDashboardCss, DASHBOARD_ROOT_CLASS } from '../src/ui/dashboardCss.js'

describe('buildDashboardCss', () => {
  test('uses a stable namespace root class', () => {
    expect(DASHBOARD_ROOT_CLASS).toBe('cd-root')
  })

  test('includes theme-aware CSS variables and key component selectors', () => {
    const css = buildDashboardCss()

    expect(css).toContain('--risu-theme-bgcolor')
    expect(css).toContain(`.${DASHBOARD_ROOT_CLASS}`)
    expect(css).toContain('.cd-sidebar')
    expect(css).toContain('.cd-card')
    expect(css).toContain('.cd-toggle')
  })

  test('includes selectors required for dashboard integration', () => {
    const css = buildDashboardCss()
    const selectors = [
      '.cd-dashboard',
      '.cd-sidebar-header',
      '.cd-kicker',
      '.cd-title',
      '.cd-subtitle',
      '.cd-sidebar-nav',
      '.cd-sidebar-btn',
      '.cd-sidebar-btn--active',
      '.cd-sidebar-footer',
      '.cd-nav-group',
      '.cd-nav-group-label',
      '.cd-content',
      '.cd-toolbar',
      '.cd-toolbar-meta',
      '.cd-toolbar-actions',
      '.cd-page',
      '.cd-page-title',
      '.cd-page-section',
      '.cd-hidden',
      '.cd-grid',
      '.cd-card-header',
      '.cd-card-title',
      '.cd-card-copy',
      '.cd-form-grid',
      '.cd-label',
      '.cd-label-text',
      '.cd-select',
      '.cd-input',
      '.cd-checkbox',
      '.cd-btn',
      '.cd-btn--primary',
      '.cd-btn--ghost',
      '.cd-btn--danger',
      '.cd-badge',
      '.cd-badge[data-kind="success"]',
      '.cd-badge[data-kind="error"]',
      '.cd-hint',
      '.cd-inline',
      '.cd-toggle',
      '.cd-toggle-track',
      '.cd-toggle-dot',
      '.cd-connection-status',
      '.cd-connection-status[data-cd-status="ok"]',
      '.cd-connection-status[data-cd-status="error"]',
      '.cd-connection-status[data-cd-status="testing"]',
      '.cd-connection-status[data-cd-status="idle"]',
      '.cd-connection-status[data-cd-status="loading"]',
      '.cd-connection-status[data-cd-status="success"]',
      '.cd-profile-list',
      '.cd-profile-item',
      '.cd-profile--active',
      '.cd-metric-list',
      '.cd-metric-item',
      '.cd-split',
      '.cd-close-btn',
      '.cd-toast',
      '.cd-footer',
      '.cd-dirty-indicator',
    ]

    for (const selector of selectors) {
      expect(css).toContain(selector)
    }
  })

  // ── UI-1: Unstyled DOM classes ──────────────────────────────────────

  test('includes styles for diagnostic/warning/recalled/breadcrumb DOM classes', () => {
    const css = buildDashboardCss()
    const selectors = [
      '.cd-warning',
      '.cd-warning-list',
      '.cd-warning-item',
      '.cd-recalled-list',
      '.cd-recalled-item',
      '.cd-breadcrumb-list',
      '.cd-breadcrumb-item',
      '.cd-badge--sm',
      '.cd-diag-section',
    ]

    for (const selector of selectors) {
      expect(css).toContain(selector)
    }
  })

  // ── UI-1: Disabled form controls ────────────────────────────────────

  test('includes disabled styling for buttons and form controls', () => {
    const css = buildDashboardCss()
    expect(css).toContain('.cd-btn:disabled')
    expect(css).toContain('.cd-input:disabled')
    expect(css).toContain('.cd-select:disabled')
    expect(css).toContain('.cd-textarea:disabled')
  })

  // ── UI-1: Focus-visible on toggle ───────────────────────────────────

  test('includes :focus-visible styling for toggle controls', () => {
    const css = buildDashboardCss()
    expect(css).toContain('.cd-toggle')
    expect(css).toContain('focus-visible')
    // Toggle should have a visible focus ring
    expect(css).toMatch(/\.cd-toggle.*focus-visible/)
  })

  // ── UI-1: Toast severity variants ───────────────────────────────────

  test('includes toast severity variant CSS', () => {
    const css = buildDashboardCss()
    expect(css).toContain('.cd-toast--success')
    expect(css).toContain('.cd-toast--info')
    expect(css).toContain('.cd-toast--warning')
    expect(css).toContain('.cd-toast--error')
  })

  // ── Toast gradient opacity regression ─────────────────────────────

  test('toast gradient color-mix top stops sum to 100% (no unintended transparency)', () => {
    const css = buildDashboardCss()
    // Extract all color-mix() calls from toast rules
    const toastSection = css.slice(css.indexOf('.cd-toast'))
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

  // ── Accessibility: reduced-motion fallback ─────────────────────────

  test('includes prefers-reduced-motion media query that disables animations', () => {
    const css = buildDashboardCss()
    expect(css).toContain('prefers-reduced-motion')
    // Should target the armed pulse, toast fade-in, and toggle transitions
    expect(css).toMatch(/prefers-reduced-motion.*reduce/s)
  })

  // ── Accessibility: toast pointer-events ────────────────────────────

  test('toast has pointer-events: none so it is click-through', () => {
    const css = buildDashboardCss()
    // The .cd-toast rule should include pointer-events: none
    const toastSection = css.slice(css.indexOf('.cd-toast'))
    expect(toastSection).toContain('pointer-events')
    expect(toastSection).toMatch(/pointer-events\s*:\s*none/)
  })

  // ── Accessibility: focus-visible for memory checkboxes ──────────────

  test('includes focus-visible styling for memory selection checkboxes', () => {
    const css = buildDashboardCss()
    expect(css).toContain('memory-select')
    expect(css).toMatch(/memory-select.*focus-visible/s)
  })

  // ── Task B: Memory list bounded scrolling ────────────────────────────

  test('.cd-memory-list has max-height and overflow-y for bounded scrolling', () => {
    const css = buildDashboardCss()
    const idx = css.indexOf('.cd-memory-list')
    expect(idx).toBeGreaterThan(-1)
    const block = css.slice(idx, css.indexOf('}', idx) + 1)
    expect(block).toContain('max-height')
    expect(block).toContain('overflow-y')
  })
})
