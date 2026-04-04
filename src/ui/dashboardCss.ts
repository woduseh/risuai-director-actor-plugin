export const DASHBOARD_ROOT_CLASS = 'cd-root'
export const DASHBOARD_STYLE_ID = 'cd-dashboard-styles'

export function buildDashboardCss(): string {
  return /* css */ `
.${DASHBOARD_ROOT_CLASS},
.cd-dashboard {
  --cd-bg: var(--risu-theme-bgcolor, #10131a);
  --cd-bg-elevated: var(--risu-theme-darkbg, #171d28);
  --cd-bg-muted: color-mix(in srgb, var(--cd-bg-elevated) 82%, black);
  --cd-border: var(--risu-theme-darkborderc, rgba(255, 255, 255, 0.08));
  --cd-border-strong: var(--risu-theme-borderc, rgba(255, 255, 255, 0.14));
  --cd-text: var(--risu-theme-textcolor, #eff3ff);
  --cd-text-muted: var(--risu-theme-textcolor2, #9ca4b5);
  --cd-accent: var(--risu-theme-selected, #64a2ff);
  --cd-accent-soft: color-mix(in srgb, var(--cd-accent) 18%, transparent);
  --cd-danger: var(--risu-theme-draculared, #ff6b7f);
  --cd-button: var(--risu-theme-darkbutton, #232b38);
  --cd-shadow: 0 24px 60px rgba(0, 0, 0, 0.34);
  --cd-radius-lg: 20px;
  --cd-radius-md: 14px;
  --cd-radius-sm: 10px;
  --cd-sidebar-width: 280px;

  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(240px, var(--cd-sidebar-width)) minmax(0, 1fr);
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--cd-accent) 18%, transparent), transparent 36%),
    linear-gradient(180deg, color-mix(in srgb, var(--cd-bg) 90%, black), var(--cd-bg));
  color: var(--cd-text);
  font-family: Inter, "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
}

.${DASHBOARD_ROOT_CLASS},
.${DASHBOARD_ROOT_CLASS} *,
.${DASHBOARD_ROOT_CLASS} *::before,
.${DASHBOARD_ROOT_CLASS} *::after,
.cd-dashboard,
.cd-dashboard *,
.cd-dashboard *::before,
.cd-dashboard *::after {
  box-sizing: border-box;
}

.cd-sidebar {
  position: sticky;
  top: 0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px 18px 18px;
  border-right: 1px solid var(--cd-border);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--cd-bg-elevated) 92%, black), color-mix(in srgb, var(--cd-bg-elevated) 78%, black));
  backdrop-filter: blur(14px);
}

.cd-sidebar-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px;
  border: 1px solid var(--cd-border);
  border-radius: var(--cd-radius-lg);
  background: color-mix(in srgb, var(--cd-bg-elevated) 90%, black);
  box-shadow: var(--cd-shadow);
}

.cd-kicker {
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--cd-text-muted);
}

.cd-title {
  margin: 0;
  font-size: 24px;
  line-height: 1.1;
  font-weight: 800;
}

.cd-subtitle {
  margin: 0;
  color: var(--cd-text-muted);
  font-size: 14px;
  line-height: 1.5;
}

.cd-sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 18px;
  flex: 1;
  overflow-y: auto;
  padding-right: 6px;
}

.cd-nav-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cd-nav-group-label {
  padding: 0 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--cd-text-muted);
}

.cd-sidebar-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: var(--cd-radius-md);
  background: transparent;
  color: var(--cd-text-muted);
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
}

.cd-sidebar-btn:hover,
.cd-sidebar-btn:focus-visible {
  background: color-mix(in srgb, var(--cd-accent) 10%, transparent);
  border-color: color-mix(in srgb, var(--cd-accent) 22%, var(--cd-border));
  color: var(--cd-text);
  outline: none;
  transform: translateX(2px);
}

.cd-sidebar-btn--active {
  background: linear-gradient(180deg, color-mix(in srgb, var(--cd-accent) 22%, transparent), color-mix(in srgb, var(--cd-accent) 12%, transparent));
  border-color: color-mix(in srgb, var(--cd-accent) 32%, var(--cd-border-strong));
  color: var(--cd-text);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cd-accent) 18%, transparent);
}

.cd-sidebar-footer {
  display: grid;
  gap: 10px;
}

.cd-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 28px 34px 40px;
}

.cd-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border: 1px solid var(--cd-border);
  border-radius: var(--cd-radius-lg);
  background: color-mix(in srgb, var(--cd-bg-elevated) 90%, black);
  box-shadow: var(--cd-shadow);
}

.cd-toolbar-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cd-toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.cd-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.cd-page-section {
  display: grid;
  gap: 14px;
}

.cd-page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
}

.cd-hidden {
  display: none !important;
}

.cd-grid {
  display: grid;
  gap: 18px;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

.cd-card {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
  border: 1px solid var(--cd-border);
  border-radius: var(--cd-radius-lg);
  background: linear-gradient(180deg, color-mix(in srgb, var(--cd-bg-elevated) 92%, white 3%), color-mix(in srgb, var(--cd-bg) 94%, black));
  box-shadow: var(--cd-shadow);
}

.cd-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.cd-card-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.cd-card-copy,
.cd-hint,
.cd-empty {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--cd-text-muted);
}

.cd-form-grid {
  display: grid;
  gap: 14px;
}

.cd-label {
  display: grid;
  gap: 8px;
}

.cd-label-text {
  font-size: 13px;
  font-weight: 700;
  color: var(--cd-text);
}

.cd-input,
.cd-select,
.cd-textarea {
  width: 100%;
  min-height: 44px;
  padding: 12px 14px;
  border: 1px solid var(--cd-border);
  border-radius: var(--cd-radius-sm);
  background: color-mix(in srgb, var(--cd-bg) 88%, black);
  color: var(--cd-text);
  font-size: 14px;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease;
}

.cd-textarea {
  min-height: 112px;
  resize: vertical;
}

.cd-input:focus,
.cd-select:focus,
.cd-textarea:focus {
  border-color: color-mix(in srgb, var(--cd-accent) 58%, var(--cd-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cd-accent) 18%, transparent);
  outline: none;
}

.cd-inline {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.cd-inline > * {
  flex: 1 1 180px;
}

.cd-toggle {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--cd-text);
  cursor: pointer;
}

.cd-checkbox {
  width: 18px;
  height: 18px;
  accent-color: var(--cd-accent);
}

.cd-toggle input[type="checkbox"] {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.cd-toggle-track {
  position: relative;
  width: 46px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid var(--cd-border-strong);
  background: color-mix(in srgb, var(--cd-button) 82%, black);
  transition: background-color 0.18s ease, border-color 0.18s ease;
}

.cd-toggle-dot {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  transition: transform 0.18s ease;
}

.cd-toggle input[type="checkbox"]:checked + .cd-toggle-track {
  background: color-mix(in srgb, var(--cd-accent) 84%, black);
  border-color: color-mix(in srgb, var(--cd-accent) 72%, white 6%);
}

.cd-toggle input[type="checkbox"]:checked + .cd-toggle-track .cd-toggle-dot {
  transform: translateX(18px);
}

.cd-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 16px;
  border: 1px solid color-mix(in srgb, var(--cd-border-strong) 90%, transparent);
  border-radius: var(--cd-radius-sm);
  background: color-mix(in srgb, var(--cd-button) 88%, black);
  color: var(--cd-text);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.18s ease, background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.cd-btn:hover,
.cd-btn:focus-visible {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--cd-accent) 18%, var(--cd-border-strong));
  outline: none;
}

.cd-btn--primary {
  background: linear-gradient(180deg, color-mix(in srgb, var(--cd-accent) 76%, white 10%), color-mix(in srgb, var(--cd-accent) 62%, black));
  border-color: color-mix(in srgb, var(--cd-accent) 58%, black);
}

.cd-btn--ghost {
  background: transparent;
}

.cd-btn--danger {
  background: color-mix(in srgb, var(--cd-danger) 22%, transparent);
  border-color: color-mix(in srgb, var(--cd-danger) 32%, var(--cd-border));
}

.cd-btn--armed {
  background: var(--cd-danger);
  color: #fff;
  border-color: var(--cd-danger);
  animation: cd-armed-pulse 1s ease-in-out infinite;
}

@keyframes cd-armed-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .78; }
}

.cd-close-btn {
  align-self: flex-start;
}

.cd-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--cd-accent) 18%, transparent);
  color: var(--cd-text);
  font-size: 12px;
  font-weight: 700;
}

.cd-badge[data-kind="success"] {
  background: color-mix(in srgb, #25c281 22%, transparent);
}

.cd-badge[data-kind="error"] {
  background: color-mix(in srgb, var(--cd-danger) 24%, transparent);
}

.cd-toast {
  padding: 10px 12px;
  border-radius: var(--cd-radius-sm);
  border: 1px solid var(--cd-border);
  background: color-mix(in srgb, var(--cd-bg-elevated) 84%, black);
  color: var(--cd-text);
}

.cd-profile-list,
.cd-chip-list,
.cd-metric-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.cd-profile-item,
.cd-chip,
.cd-metric-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--cd-border);
  border-radius: var(--cd-radius-sm);
  background: color-mix(in srgb, var(--cd-bg) 92%, black);
}

.cd-profile-item {
  cursor: pointer;
  transition: border-color 0.18s ease, transform 0.18s ease, background-color 0.18s ease;
}

.cd-profile-item:hover {
  transform: translateX(2px);
  border-color: color-mix(in srgb, var(--cd-accent) 28%, var(--cd-border));
}

.cd-profile--active {
  border-color: color-mix(in srgb, var(--cd-accent) 48%, var(--cd-border));
  background: color-mix(in srgb, var(--cd-accent) 14%, transparent);
}

.cd-connection-status[data-cd-status="idle"] { color: var(--cd-text-muted); }
.cd-connection-status[data-cd-status="loading"],
.cd-connection-status[data-cd-status="testing"] { color: var(--cd-accent); }
.cd-connection-status[data-cd-status="success"],
.cd-connection-status[data-cd-status="ok"] { color: #4ee0a2; }
.cd-connection-status[data-cd-status="error"] { color: var(--cd-danger); }

.cd-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.cd-dirty-indicator {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--cd-text-muted);
  font-size: 13px;
  font-weight: 700;
}

.cd-dirty-indicator::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--cd-accent) 88%, white 8%);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--cd-accent) 12%, transparent);
}

.cd-split {
  display: grid;
  gap: 18px;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.cd-memory-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 400px;
  overflow-y: auto;
}

.cd-memory-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--cd-border);
  border-radius: var(--cd-radius-sm);
  background: color-mix(in srgb, var(--cd-bg) 92%, black);
}

.cd-btn--sm {
  min-height: 32px;
  padding: 0 10px;
  font-size: 12px;
  flex-shrink: 0;
}

.cd-add-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.cd-add-row .cd-input--add {
  flex: 1;
  min-height: 36px;
}

.cd-quick-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

@media (max-width: 960px) {
  .${DASHBOARD_ROOT_CLASS},
  .cd-dashboard {
    grid-template-columns: 1fr;
  }

  .cd-sidebar {
    min-height: auto;
    position: static;
    border-right: none;
    border-bottom: 1px solid var(--cd-border);
  }

  .cd-content {
    padding: 18px 18px 28px;
  }
}

.cd-dashboard {
  position: relative;
}

.cd-sidebar-header {
  position: relative;
}

.cd-content {
  flex: 1;
  overflow-y: auto;
}

.cd-page-title {
  margin: 0;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 700;
}

.cd-page-section {
  display: grid;
  gap: 14px;
  padding: 20px;
  border: 1px solid var(--cd-border);
  border-radius: var(--cd-radius-md);
  background: color-mix(in srgb, var(--cd-bg-elevated) 88%, black);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18);
}

.cd-page-section > h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.cd-page-section > .cd-btn,
.cd-page-section > .cd-connection-status {
  justify-self: start;
}

.cd-label > span {
  font-size: 13px;
  font-weight: 700;
  color: var(--cd-text);
}

.cd-checkbox {
  inline-size: 16px;
  block-size: 16px;
  margin: 0;
  accent-color: var(--cd-accent);
  cursor: pointer;
}

.cd-connection-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--cd-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--cd-bg) 82%, black);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
}

.cd-connection-status[data-cd-status="ok"],
.cd-connection-status[data-cd-status="success"] {
  color: #4ee0a2;
  border-color: color-mix(in srgb, #4ee0a2 32%, var(--cd-border));
  background: color-mix(in srgb, #4ee0a2 10%, transparent);
}

.cd-connection-status[data-cd-status="error"] {
  border-color: color-mix(in srgb, var(--cd-danger) 32%, var(--cd-border));
  background: color-mix(in srgb, var(--cd-danger) 10%, transparent);
}

.cd-connection-status[data-cd-status="testing"],
.cd-connection-status[data-cd-status="loading"] {
  color: #f4c95d;
  border-color: color-mix(in srgb, #f4c95d 32%, var(--cd-border));
  background: color-mix(in srgb, #f4c95d 10%, transparent);
}

.cd-close-btn {
  background: transparent;
  color: var(--cd-text-muted);
  border-color: color-mix(in srgb, var(--cd-danger) 28%, var(--cd-border));
}

.cd-close-btn:hover,
.cd-close-btn:focus-visible {
  background: color-mix(in srgb, var(--cd-accent) 12%, transparent);
  border-color: color-mix(in srgb, var(--cd-accent) 28%, var(--cd-border));
  color: var(--cd-text);
}

.cd-sidebar-header .cd-close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  min-width: 32px;
  padding: 0;
  aspect-ratio: 1;
  border-radius: 999px;
}

.cd-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
  padding: 18px 0 4px;
  margin-top: auto;
  background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--cd-bg) 96%, black) 42%);
  backdrop-filter: blur(10px);
}

.cd-dirty-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--cd-accent) 18%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cd-accent) 24%, transparent);
  color: var(--cd-text);
  font-size: 12px;
  font-weight: 700;
}

.cd-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  z-index: 10001;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: min(320px, calc(100vw - 32px));
  padding: 12px 18px;
  border: 1px solid color-mix(in srgb, var(--cd-accent) 38%, var(--cd-border));
  border-radius: 999px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--cd-accent) 93%, white 7%), color-mix(in srgb, var(--cd-accent) 62%, black));
  box-shadow: var(--cd-shadow);
  color: #09111f;
  font-size: 14px;
  font-weight: 700;
  transform: translateX(-50%);
  animation: cd-toast-fade-in 0.18s ease-out;
}

/* ── Diagnostics / Warning / Recalled / Breadcrumb surfaces ─────────── */

.cd-diag-section {
  display: grid;
  gap: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--cd-border);
}

.cd-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--cd-danger) 28%, var(--cd-border));
  border-radius: var(--cd-radius-sm);
  background: color-mix(in srgb, var(--cd-danger) 8%, transparent);
  color: var(--cd-text);
  font-size: 13px;
  font-weight: 600;
}

.cd-warning-list {
  display: grid;
  gap: 8px;
}

.cd-warning-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, #f4c95d 22%, var(--cd-border));
  border-radius: var(--cd-radius-sm);
  background: color-mix(in srgb, #f4c95d 8%, transparent);
  color: var(--cd-text);
  font-size: 13px;
  font-weight: 600;
}

.cd-recalled-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.cd-recalled-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--cd-border);
  border-radius: var(--cd-radius-sm);
  background: color-mix(in srgb, var(--cd-bg) 92%, black);
  font-size: 13px;
}

.cd-breadcrumb-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 200px;
  overflow-y: auto;
}

.cd-breadcrumb-item {
  padding: 6px 10px;
  border-left: 3px solid color-mix(in srgb, var(--cd-accent) 44%, transparent);
  font-size: 12px;
  color: var(--cd-text-muted);
  line-height: 1.5;
}

.cd-badge--sm {
  min-height: 20px;
  padding: 0 6px;
  font-size: 10px;
}

/* ── Disabled form controls ─────────────────────────────────────────── */

.cd-btn:disabled,
.cd-input:disabled,
.cd-select:disabled,
.cd-textarea:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── Focus-visible on toggle ────────────────────────────────────────── */

.cd-toggle input[type="checkbox"]:focus-visible + .cd-toggle-track {
  outline: 2px solid var(--cd-accent);
  outline-offset: 2px;
}

/* ── Toast severity variants ────────────────────────────────────────── */

.cd-toast--success {
  border-color: color-mix(in srgb, #25c281 48%, var(--cd-border));
  background: linear-gradient(180deg, color-mix(in srgb, #25c281 93%, white 7%), color-mix(in srgb, #25c281 62%, black));
}

.cd-toast--info {
  border-color: color-mix(in srgb, var(--cd-accent) 38%, var(--cd-border));
  background: linear-gradient(180deg, color-mix(in srgb, var(--cd-accent) 93%, white 7%), color-mix(in srgb, var(--cd-accent) 62%, black));
}

.cd-toast--warning {
  border-color: color-mix(in srgb, #f4c95d 48%, var(--cd-border));
  background: linear-gradient(180deg, color-mix(in srgb, #f4c95d 93%, white 7%), color-mix(in srgb, #f4c95d 62%, black));
}

.cd-toast--error {
  border-color: color-mix(in srgb, var(--cd-danger) 48%, var(--cd-border));
  background: linear-gradient(180deg, color-mix(in srgb, var(--cd-danger) 93%, white 7%), color-mix(in srgb, var(--cd-danger) 62%, black));
}

@keyframes cd-toast-fade-in {
  from {
    opacity: 0;
    transform: translate(-50%, 10px);
  }

  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

/* ── Toast pointer-events (click-through) ───────────────────────────── */

.cd-toast {
  pointer-events: none;
}

/* ── Focus-visible for memory selection checkboxes ──────────────────── */

[data-cd-role="memory-select"]:focus-visible {
  outline: 2px solid var(--cd-accent);
  outline-offset: 2px;
}

/* ── Memory Workbench ───────────────────────────────────────────────── */

.cd-workbench-filters {
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.cd-workbench-filters .cd-label {
  min-width: 120px;
}

.cd-workbench-doc-title {
  font-weight: 600;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cd-workbench-doc-meta {
  color: var(--cd-text-muted);
  font-size: 0.82em;
  flex-shrink: 0;
}

.cd-workbench-preview {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
  font-size: 0.85em;
  color: var(--cd-text-muted);
  background: var(--cd-bg-muted);
  border-radius: var(--cd-radius-sm);
  padding: 12px;
  max-height: 300px;
  overflow-y: auto;
  margin-top: 4px;
}

.cd-workbench-error {
  color: var(--cd-danger);
}

/* ── Progress banner ───────────────────────────────────────────────── */

.cd-progress-banner {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 0;
  max-height: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  color: var(--cd-accent);
  background: var(--cd-accent-soft);
  border-bottom: 1px solid transparent;
  transition: max-height 0.2s ease, padding 0.2s ease;
}

.cd-progress-banner:not(:empty) {
  max-height: 48px;
  padding: 8px 18px;
  border-bottom-color: var(--cd-border);
}

/* ── Reduced motion ─────────────────────────────────────────────────── */

@media (prefers-reduced-motion: reduce) {
  .cd-btn--armed {
    animation: none;
  }

  .cd-toast {
    animation: none;
  }

  .cd-toggle-track,
  .cd-toggle-dot {
    transition: none;
  }

  .cd-progress-banner {
    transition: none;
  }
}
`
}
