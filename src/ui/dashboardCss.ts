export const DASHBOARD_ROOT_CLASS = 'da-root'
export const DASHBOARD_STYLE_ID = 'da-dashboard-styles'

export function buildDashboardCss(): string {
  return /* css */ `
.${DASHBOARD_ROOT_CLASS},
.da-dashboard {
  --da-bg: var(--risu-theme-bgcolor, #10131a);
  --da-bg-elevated: var(--risu-theme-darkbg, #171d28);
  --da-bg-muted: color-mix(in srgb, var(--da-bg-elevated) 82%, black);
  --da-border: var(--risu-theme-darkborderc, rgba(255, 255, 255, 0.08));
  --da-border-strong: var(--risu-theme-borderc, rgba(255, 255, 255, 0.14));
  --da-text: var(--risu-theme-textcolor, #eff3ff);
  --da-text-muted: var(--risu-theme-textcolor2, #9ca4b5);
  --da-accent: var(--risu-theme-selected, #64a2ff);
  --da-accent-soft: color-mix(in srgb, var(--da-accent) 18%, transparent);
  --da-danger: var(--risu-theme-draculared, #ff6b7f);
  --da-button: var(--risu-theme-darkbutton, #232b38);
  --da-shadow: 0 24px 60px rgba(0, 0, 0, 0.34);
  --da-radius-lg: 20px;
  --da-radius-md: 14px;
  --da-radius-sm: 10px;
  --da-sidebar-width: 280px;

  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(240px, var(--da-sidebar-width)) minmax(0, 1fr);
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--da-accent) 18%, transparent), transparent 36%),
    linear-gradient(180deg, color-mix(in srgb, var(--da-bg) 90%, black), var(--da-bg));
  color: var(--da-text);
  font-family: Inter, "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
}

.${DASHBOARD_ROOT_CLASS},
.${DASHBOARD_ROOT_CLASS} *,
.${DASHBOARD_ROOT_CLASS} *::before,
.${DASHBOARD_ROOT_CLASS} *::after,
.da-dashboard,
.da-dashboard *,
.da-dashboard *::before,
.da-dashboard *::after {
  box-sizing: border-box;
}

.da-sidebar {
  position: sticky;
  top: 0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px 18px 18px;
  border-right: 1px solid var(--da-border);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--da-bg-elevated) 92%, black), color-mix(in srgb, var(--da-bg-elevated) 78%, black));
  backdrop-filter: blur(14px);
}

.da-sidebar-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px;
  border: 1px solid var(--da-border);
  border-radius: var(--da-radius-lg);
  background: color-mix(in srgb, var(--da-bg-elevated) 90%, black);
  box-shadow: var(--da-shadow);
}

.da-kicker {
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--da-text-muted);
}

.da-title {
  margin: 0;
  font-size: 24px;
  line-height: 1.1;
  font-weight: 800;
}

.da-subtitle {
  margin: 0;
  color: var(--da-text-muted);
  font-size: 14px;
  line-height: 1.5;
}

.da-sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 18px;
  flex: 1;
  overflow-y: auto;
  padding-right: 6px;
}

.da-nav-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.da-nav-group-label {
  padding: 0 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--da-text-muted);
}

.da-sidebar-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: var(--da-radius-md);
  background: transparent;
  color: var(--da-text-muted);
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
}

.da-sidebar-btn:hover,
.da-sidebar-btn:focus-visible {
  background: color-mix(in srgb, var(--da-accent) 10%, transparent);
  border-color: color-mix(in srgb, var(--da-accent) 22%, var(--da-border));
  color: var(--da-text);
  outline: none;
  transform: translateX(2px);
}

.da-sidebar-btn--active {
  background: linear-gradient(180deg, color-mix(in srgb, var(--da-accent) 22%, transparent), color-mix(in srgb, var(--da-accent) 12%, transparent));
  border-color: color-mix(in srgb, var(--da-accent) 32%, var(--da-border-strong));
  color: var(--da-text);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--da-accent) 18%, transparent);
}

.da-sidebar-footer {
  display: grid;
  gap: 10px;
}

.da-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 28px 34px 40px;
}

.da-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border: 1px solid var(--da-border);
  border-radius: var(--da-radius-lg);
  background: color-mix(in srgb, var(--da-bg-elevated) 90%, black);
  box-shadow: var(--da-shadow);
}

.da-toolbar-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.da-toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.da-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.da-page-section {
  display: grid;
  gap: 14px;
}

.da-page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
}

.da-hidden {
  display: none !important;
}

.da-grid {
  display: grid;
  gap: 18px;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

.da-card {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
  border: 1px solid var(--da-border);
  border-radius: var(--da-radius-lg);
  background: linear-gradient(180deg, color-mix(in srgb, var(--da-bg-elevated) 92%, white 3%), color-mix(in srgb, var(--da-bg) 94%, black));
  box-shadow: var(--da-shadow);
}

.da-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.da-card-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.da-card-copy,
.da-hint,
.da-empty {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--da-text-muted);
}

.da-form-grid {
  display: grid;
  gap: 14px;
}

.da-label {
  display: grid;
  gap: 8px;
}

.da-label-text {
  font-size: 13px;
  font-weight: 700;
  color: var(--da-text);
}

.da-input,
.da-select,
.da-textarea {
  width: 100%;
  min-height: 44px;
  padding: 12px 14px;
  border: 1px solid var(--da-border);
  border-radius: var(--da-radius-sm);
  background: color-mix(in srgb, var(--da-bg) 88%, black);
  color: var(--da-text);
  font-size: 14px;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease;
}

.da-textarea {
  min-height: 112px;
  resize: vertical;
}

.da-input:focus,
.da-select:focus,
.da-textarea:focus {
  border-color: color-mix(in srgb, var(--da-accent) 58%, var(--da-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--da-accent) 18%, transparent);
  outline: none;
}

.da-inline {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.da-inline > * {
  flex: 1 1 180px;
}

.da-toggle {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--da-text);
  cursor: pointer;
}

.da-checkbox {
  width: 18px;
  height: 18px;
  accent-color: var(--da-accent);
}

.da-toggle input[type="checkbox"] {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.da-toggle-track {
  position: relative;
  width: 46px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid var(--da-border-strong);
  background: color-mix(in srgb, var(--da-button) 82%, black);
  transition: background-color 0.18s ease, border-color 0.18s ease;
}

.da-toggle-dot {
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

.da-toggle input[type="checkbox"]:checked + .da-toggle-track {
  background: color-mix(in srgb, var(--da-accent) 84%, black);
  border-color: color-mix(in srgb, var(--da-accent) 72%, white 6%);
}

.da-toggle input[type="checkbox"]:checked + .da-toggle-track .da-toggle-dot {
  transform: translateX(18px);
}

.da-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 16px;
  border: 1px solid color-mix(in srgb, var(--da-border-strong) 90%, transparent);
  border-radius: var(--da-radius-sm);
  background: color-mix(in srgb, var(--da-button) 88%, black);
  color: var(--da-text);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.18s ease, background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.da-btn:hover,
.da-btn:focus-visible {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--da-accent) 18%, var(--da-border-strong));
  outline: none;
}

.da-btn--primary {
  background: linear-gradient(180deg, color-mix(in srgb, var(--da-accent) 76%, white 10%), color-mix(in srgb, var(--da-accent) 62%, black));
  border-color: color-mix(in srgb, var(--da-accent) 58%, black);
}

.da-btn--ghost {
  background: transparent;
}

.da-btn--danger {
  background: color-mix(in srgb, var(--da-danger) 22%, transparent);
  border-color: color-mix(in srgb, var(--da-danger) 32%, var(--da-border));
}

.da-btn--armed {
  background: var(--da-danger);
  color: #fff;
  border-color: var(--da-danger);
  animation: da-armed-pulse 1s ease-in-out infinite;
}

@keyframes da-armed-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .78; }
}

.da-close-btn {
  align-self: flex-start;
}

.da-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--da-accent) 18%, transparent);
  color: var(--da-text);
  font-size: 12px;
  font-weight: 700;
}

.da-badge[data-kind="success"] {
  background: color-mix(in srgb, #25c281 22%, transparent);
}

.da-badge[data-kind="error"] {
  background: color-mix(in srgb, var(--da-danger) 24%, transparent);
}

.da-toast {
  padding: 10px 12px;
  border-radius: var(--da-radius-sm);
  border: 1px solid var(--da-border);
  background: color-mix(in srgb, var(--da-bg-elevated) 84%, black);
  color: var(--da-text);
}

.da-profile-list,
.da-chip-list,
.da-metric-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.da-profile-item,
.da-chip,
.da-metric-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--da-border);
  border-radius: var(--da-radius-sm);
  background: color-mix(in srgb, var(--da-bg) 92%, black);
}

.da-profile-item {
  cursor: pointer;
  transition: border-color 0.18s ease, transform 0.18s ease, background-color 0.18s ease;
}

.da-profile-item:hover {
  transform: translateX(2px);
  border-color: color-mix(in srgb, var(--da-accent) 28%, var(--da-border));
}

.da-profile--active {
  border-color: color-mix(in srgb, var(--da-accent) 48%, var(--da-border));
  background: color-mix(in srgb, var(--da-accent) 14%, transparent);
}

.da-connection-status[data-da-status="idle"] { color: var(--da-text-muted); }
.da-connection-status[data-da-status="loading"],
.da-connection-status[data-da-status="testing"] { color: var(--da-accent); }
.da-connection-status[data-da-status="success"],
.da-connection-status[data-da-status="ok"] { color: #4ee0a2; }
.da-connection-status[data-da-status="error"] { color: var(--da-danger); }

.da-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.da-dirty-indicator {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--da-text-muted);
  font-size: 13px;
  font-weight: 700;
}

.da-dirty-indicator::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--da-accent) 88%, white 8%);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--da-accent) 12%, transparent);
}

.da-split {
  display: grid;
  gap: 18px;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.da-memory-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 400px;
  overflow-y: auto;
}

.da-memory-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--da-border);
  border-radius: var(--da-radius-sm);
  background: color-mix(in srgb, var(--da-bg) 92%, black);
}

.da-btn--sm {
  min-height: 32px;
  padding: 0 10px;
  font-size: 12px;
  flex-shrink: 0;
}

.da-add-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.da-add-row .da-input--add {
  flex: 1;
  min-height: 36px;
}

.da-quick-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

@media (max-width: 960px) {
  .${DASHBOARD_ROOT_CLASS},
  .da-dashboard {
    grid-template-columns: 1fr;
  }

  .da-sidebar {
    min-height: auto;
    position: static;
    border-right: none;
    border-bottom: 1px solid var(--da-border);
  }

  .da-content {
    padding: 18px 18px 28px;
  }
}

.da-dashboard {
  position: relative;
}

.da-sidebar-header {
  position: relative;
}

.da-content {
  flex: 1;
  overflow-y: auto;
}

.da-page-title {
  margin: 0;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 700;
}

.da-page-section {
  display: grid;
  gap: 14px;
  padding: 20px;
  border: 1px solid var(--da-border);
  border-radius: var(--da-radius-md);
  background: color-mix(in srgb, var(--da-bg-elevated) 88%, black);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18);
}

.da-page-section > h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.da-page-section > .da-btn,
.da-page-section > .da-connection-status {
  justify-self: start;
}

.da-label > span {
  font-size: 13px;
  font-weight: 700;
  color: var(--da-text);
}

.da-checkbox {
  inline-size: 16px;
  block-size: 16px;
  margin: 0;
  accent-color: var(--da-accent);
  cursor: pointer;
}

.da-connection-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--da-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--da-bg) 82%, black);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
}

.da-connection-status[data-da-status="ok"],
.da-connection-status[data-da-status="success"] {
  color: #4ee0a2;
  border-color: color-mix(in srgb, #4ee0a2 32%, var(--da-border));
  background: color-mix(in srgb, #4ee0a2 10%, transparent);
}

.da-connection-status[data-da-status="error"] {
  border-color: color-mix(in srgb, var(--da-danger) 32%, var(--da-border));
  background: color-mix(in srgb, var(--da-danger) 10%, transparent);
}

.da-connection-status[data-da-status="testing"],
.da-connection-status[data-da-status="loading"] {
  color: #f4c95d;
  border-color: color-mix(in srgb, #f4c95d 32%, var(--da-border));
  background: color-mix(in srgb, #f4c95d 10%, transparent);
}

.da-close-btn {
  background: transparent;
  color: var(--da-text-muted);
  border-color: color-mix(in srgb, var(--da-danger) 28%, var(--da-border));
}

.da-close-btn:hover,
.da-close-btn:focus-visible {
  background: color-mix(in srgb, var(--da-accent) 12%, transparent);
  border-color: color-mix(in srgb, var(--da-accent) 28%, var(--da-border));
  color: var(--da-text);
}

.da-sidebar-header .da-close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  min-width: 32px;
  padding: 0;
  aspect-ratio: 1;
  border-radius: 999px;
}

.da-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
  padding: 18px 0 4px;
  margin-top: auto;
  background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--da-bg) 96%, black) 42%);
  backdrop-filter: blur(10px);
}

.da-dirty-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--da-accent) 18%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--da-accent) 24%, transparent);
  color: var(--da-text);
  font-size: 12px;
  font-weight: 700;
}

.da-toast {
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
  border: 1px solid color-mix(in srgb, var(--da-accent) 38%, var(--da-border));
  border-radius: 999px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--da-accent) 93%, white 7%), color-mix(in srgb, var(--da-accent) 62%, black));
  box-shadow: var(--da-shadow);
  color: #09111f;
  font-size: 14px;
  font-weight: 700;
  transform: translateX(-50%);
  animation: da-toast-fade-in 0.18s ease-out;
}

/* ── Diagnostics / Warning / Recalled / Breadcrumb surfaces ─────────── */

.da-diag-section {
  display: grid;
  gap: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--da-border);
}

.da-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--da-danger) 28%, var(--da-border));
  border-radius: var(--da-radius-sm);
  background: color-mix(in srgb, var(--da-danger) 8%, transparent);
  color: var(--da-text);
  font-size: 13px;
  font-weight: 600;
}

.da-warning-list {
  display: grid;
  gap: 8px;
}

.da-warning-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, #f4c95d 22%, var(--da-border));
  border-radius: var(--da-radius-sm);
  background: color-mix(in srgb, #f4c95d 8%, transparent);
  color: var(--da-text);
  font-size: 13px;
  font-weight: 600;
}

.da-recalled-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.da-recalled-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--da-border);
  border-radius: var(--da-radius-sm);
  background: color-mix(in srgb, var(--da-bg) 92%, black);
  font-size: 13px;
}

.da-breadcrumb-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 200px;
  overflow-y: auto;
}

.da-breadcrumb-item {
  padding: 6px 10px;
  border-left: 3px solid color-mix(in srgb, var(--da-accent) 44%, transparent);
  font-size: 12px;
  color: var(--da-text-muted);
  line-height: 1.5;
}

.da-badge--sm {
  min-height: 20px;
  padding: 0 6px;
  font-size: 10px;
}

/* ── Disabled form controls ─────────────────────────────────────────── */

.da-btn:disabled,
.da-input:disabled,
.da-select:disabled,
.da-textarea:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── Focus-visible on toggle ────────────────────────────────────────── */

.da-toggle input[type="checkbox"]:focus-visible + .da-toggle-track {
  outline: 2px solid var(--da-accent);
  outline-offset: 2px;
}

/* ── Toast severity variants ────────────────────────────────────────── */

.da-toast--success {
  border-color: color-mix(in srgb, #25c281 48%, var(--da-border));
  background: linear-gradient(180deg, color-mix(in srgb, #25c281 93%, white 7%), color-mix(in srgb, #25c281 62%, black));
}

.da-toast--info {
  border-color: color-mix(in srgb, var(--da-accent) 38%, var(--da-border));
  background: linear-gradient(180deg, color-mix(in srgb, var(--da-accent) 93%, white 7%), color-mix(in srgb, var(--da-accent) 62%, black));
}

.da-toast--warning {
  border-color: color-mix(in srgb, #f4c95d 48%, var(--da-border));
  background: linear-gradient(180deg, color-mix(in srgb, #f4c95d 93%, white 7%), color-mix(in srgb, #f4c95d 62%, black));
}

.da-toast--error {
  border-color: color-mix(in srgb, var(--da-danger) 48%, var(--da-border));
  background: linear-gradient(180deg, color-mix(in srgb, var(--da-danger) 93%, white 7%), color-mix(in srgb, var(--da-danger) 62%, black));
}

@keyframes da-toast-fade-in {
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

.da-toast {
  pointer-events: none;
}

/* ── Focus-visible for memory selection checkboxes ──────────────────── */

[data-da-role="memory-select"]:focus-visible {
  outline: 2px solid var(--da-accent);
  outline-offset: 2px;
}

/* ── Memory Workbench ───────────────────────────────────────────────── */

.da-workbench-filters {
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.da-workbench-filters .da-label {
  min-width: 120px;
}

.da-workbench-doc-title {
  font-weight: 600;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.da-workbench-doc-meta {
  color: var(--da-text-muted);
  font-size: 0.82em;
  flex-shrink: 0;
}

.da-workbench-preview {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
  font-size: 0.85em;
  color: var(--da-text-muted);
  background: var(--da-bg-muted);
  border-radius: var(--da-radius-sm);
  padding: 12px;
  max-height: 300px;
  overflow-y: auto;
  margin-top: 4px;
}

.da-workbench-error {
  color: var(--da-danger);
}

/* ── Reduced motion ─────────────────────────────────────────────────── */

@media (prefers-reduced-motion: reduce) {
  .da-btn--armed {
    animation: none;
  }

  .da-toast {
    animation: none;
  }

  .da-toggle-track,
  .da-toggle-dot {
    transition: none;
  }
}
`
}
