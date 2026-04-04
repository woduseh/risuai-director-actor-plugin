import { createEmptyState } from '../src/contracts/types.js'
import { DEFAULT_DIRECTOR_PROMPT_PRESET } from '../src/director/prompt.js'
import {
  buildDashboardMarkup,
  buildPageTitle,
  DASHBOARD_TABS
} from '../src/ui/dashboardDom.js'
import {
  createDefaultProfileManifest,
  createDefaultMemoryOpsStatus,
  normalizePersistedSettings
} from '../src/ui/dashboardState.js'
import { createDefaultDiagnosticsSnapshot } from '../src/runtime/diagnostics.js'
import type { DiagnosticsSnapshot } from '../src/runtime/diagnostics.js'
import { setLocale } from '../src/ui/i18n.js'

describe('buildDashboardMarkup', () => {
  afterEach(() => {
    setLocale('en')
  })

  test('renders sidebar navigation and page shells for all dashboard tabs', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'general',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: {
        kind: 'idle',
        message: 'Ready to test'
      }
    })

    for (const tab of DASHBOARD_TABS) {
      expect(markup).toContain(`data-cd-target="${tab.id}"`)
      expect(markup).toContain(`id="cd-page-${tab.id}"`)
    }

    expect(markup).toContain('Continuity Console')
    expect(markup).toContain('Settings Profiles')
    expect(markup).toContain('Test Connection')
    expect(markup).toContain('Memory & Cache')
  })

  test('renders built-in profile names in Korean when locale is ko', () => {
    setLocale('ko')
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'settings-profiles',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' }
    })

    expect(markup).toContain('균형')
    expect(markup).toContain('부드러움')
    expect(markup).toContain('엄격')
    expect(markup).not.toContain('>Balanced<')
    expect(markup).not.toContain('>Gentle<')
    expect(markup).not.toContain('>Strict<')
  })

  test('renders prompt preset controls on the prompt tuning page', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'prompt-tuning',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' }
    })

    expect(markup).toContain('data-cd-role="prompt-preset-select"')
    expect(markup).toContain('data-cd-role="prompt-preset-name"')
    expect(markup).toContain('data-cd-role="prompt-pre-request-system"')
    expect(markup).toContain('data-cd-role="prompt-post-response-user"')
    expect(markup).toContain('data-cd-action="create-prompt-preset"')
    expect(markup).toContain(DEFAULT_DIRECTOR_PROMPT_PRESET.preRequestSystemTemplate.slice(0, 32))
  })

  test('prompt tuning card copy explains brief soft cap and actor long-memory injection', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'prompt-tuning',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' }
    })

    // Card copy should mention both brief and long-memory behavior
    expect(markup).toContain('soft cap')
    expect(markup).toContain('long memory')

    // Brief token cap label should indicate soft cap
    expect(markup).toContain('Brief Token Soft Cap')
  })

  test('prompt tuning card copy shows updated wording in Korean', () => {
    setLocale('ko')
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'prompt-tuning',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' }
    })

    // Korean card copy should mention soft cap and long-memory
    expect(markup).toContain('소프트 캡')
    expect(markup).toContain('장기 메모리')
  })

  test('renders expanded director and embedding provider controls on the model settings page', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({ embeddingsEnabled: true }),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'model-settings',
      modelOptions: ['gpt-5.4-mini'],
      connectionStatus: { kind: 'idle', message: '' }
    })

    expect(markup).toContain('value="copilot"')
    expect(markup).toContain('value="vertex"')
    expect(markup).toContain('data-cd-field="embeddingProvider"')
    expect(markup).toContain('data-cd-field="embeddingBaseUrl"')
    expect(markup).toContain('data-cd-field="embeddingApiKey"')
    expect(markup).toContain('data-cd-field="embeddingModel"')
    expect(markup).toContain('data-cd-field="embeddingDimensions"')
    expect(markup).toContain('value="voyageai"')
  })

  test('renders a current-chat backfill action on the memory page', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-5.4-mini'],
      connectionStatus: { kind: 'idle', message: '' },
    })

    expect(markup).toContain('data-cd-action="backfill-current-chat"')
    expect(markup).toContain('data-cd-action="regenerate-current-chat"')
  })

  test('escapes settings field values and model option ids in model-settings markup', () => {
    const injectedValue = 'https://api.example.com/v1" data-evil="1'
    const injectedModel = 'gpt-bad" data-evil="1'

    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({
        directorBaseUrl: injectedValue,
        directorApiKey: injectedValue,
        directorModel: injectedModel,
        embeddingBaseUrl: injectedValue,
        embeddingApiKey: injectedValue,
        embeddingModel: injectedModel,
      }),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'model-settings',
      modelOptions: [injectedModel],
      connectionStatus: { kind: 'idle', message: '' },
    })

    expect(markup).not.toContain('data-evil="1"')
    expect(markup).toContain('&quot;')
  })

  // ── Memory Operations Status Card ──────────────────────────────────

  test('renders memory operations status card with action buttons and document counts', () => {
    const state = createEmptyState()
    state.memory.summaries.push(
      { id: 's1', text: 'a', recencyWeight: 1, updatedAt: 1 },
      { id: 's2', text: 'b', recencyWeight: 1, updatedAt: 2 },
      { id: 's3', text: 'c', recencyWeight: 1, updatedAt: 3 },
    )
    state.memory.worldFacts.push({ id: 'w1', text: 'w', updatedAt: 1 })

    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: state,
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
      memoryOpsStatus: {
        lastExtractTs: 1700000000000,
        lastDreamTs: 1700000500000,
        notebookFreshness: 'current',
        documentCounts: { summaries: 3, continuityFacts: 0, worldFacts: 1, entities: 0, relations: 0 },
        fallbackRetrievalEnabled: false,
        isMemoryLocked: false,
        staleWarnings: [],
        recalledDocs: [],
        diagnostics: createDefaultDiagnosticsSnapshot(),
        embeddingCache: { enabled: false, supported: true, readyCount: 0, staleCount: 0, missingCount: 0, currentVersion: '' },
      },
    })

    expect(markup).toContain('data-cd-role="memory-ops-status"')
    expect(markup).toContain('data-cd-action="force-extract"')
    expect(markup).toContain('data-cd-action="force-dream"')
    expect(markup).toContain('data-cd-action="inspect-recalled"')
    expect(markup).toContain('data-cd-action="toggle-fallback-retrieval"')
    expect(markup).toContain('data-cd-action="refresh-embeddings"')
  })

  test('renders embedding status section in memory ops card', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
      memoryOpsStatus: {
        ...createDefaultMemoryOpsStatus(),
        embeddingCache: {
          enabled: true,
          supported: true,
          readyCount: 5,
          staleCount: 2,
          missingCount: 1,
          currentVersion: 'emb-abc123',
        },
      },
    })

    expect(markup).toContain('data-cd-role="embedding-status"')
    expect(markup).toContain('emb-abc123')
    // Should contain counts
    expect(markup).toContain('5')
    expect(markup).toContain('2')
    expect(markup).toContain('1')
  })

  test('embedding status shows disabled badge when embeddings are off', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
      memoryOpsStatus: {
        ...createDefaultMemoryOpsStatus(),
        embeddingCache: {
          enabled: false,
          supported: true,
          readyCount: 0,
          staleCount: 0,
          missingCount: 0,
          currentVersion: '',
        },
      },
    })

    expect(markup).toContain('data-cd-role="embedding-status"')
    expect(markup).toContain('Disabled')
  })

  test('renders stale-memory warnings when present in memory ops status', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
      memoryOpsStatus: {
        lastExtractTs: 0,
        lastDreamTs: 0,
        notebookFreshness: 'stale',
        documentCounts: { summaries: 0, continuityFacts: 0, worldFacts: 0, entities: 0, relations: 0 },
        fallbackRetrievalEnabled: false,
        isMemoryLocked: false,
        staleWarnings: ['Memory "Character A" may be outdated'],
        recalledDocs: [],
        diagnostics: createDefaultDiagnosticsSnapshot(),
        embeddingCache: { enabled: false, supported: true, readyCount: 0, staleCount: 0, missingCount: 0, currentVersion: '' },
      },
    })

    expect(markup).toContain('data-cd-role="stale-warnings"')
    expect(markup).toContain('Character A')
  })

  test('renders locked-memory indicator when memory is locked', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
      memoryOpsStatus: {
        lastExtractTs: 0,
        lastDreamTs: 0,
        notebookFreshness: 'unknown',
        documentCounts: { summaries: 0, continuityFacts: 0, worldFacts: 0, entities: 0, relations: 0 },
        fallbackRetrievalEnabled: false,
        isMemoryLocked: true,
        staleWarnings: [],
        recalledDocs: [],
        diagnostics: createDefaultDiagnosticsSnapshot(),
        embeddingCache: { enabled: false, supported: true, readyCount: 0, staleCount: 0, missingCount: 0, currentVersion: '' },
      },
    })

    expect(markup).toContain('data-cd-role="memory-locked"')
  })

  test('locked badge does not appear in stale-warnings list', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
      memoryOpsStatus: {
        lastExtractTs: 0,
        lastDreamTs: 0,
        notebookFreshness: 'unknown',
        documentCounts: { summaries: 0, continuityFacts: 0, worldFacts: 0, entities: 0, relations: 0 },
        fallbackRetrievalEnabled: false,
        isMemoryLocked: true,
        staleWarnings: [],
        recalledDocs: [],
        diagnostics: createDefaultDiagnosticsSnapshot(),
        embeddingCache: { enabled: false, supported: true, readyCount: 0, staleCount: 0, missingCount: 0, currentVersion: '' },
      },
    })

    expect(markup).toContain('data-cd-role="memory-locked"')
    expect(markup).not.toContain('data-cd-role="stale-warnings"')
  })

  // ── Diagnostics section ─────────────────────────────────────────────

  test('renders diagnostics section with default snapshot', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
      memoryOpsStatus: createDefaultMemoryOpsStatus(),
    })

    expect(markup).toContain('data-cd-role="diagnostics"')
    expect(markup).toContain('data-cd-role="diag-last-hook"')
    expect(markup).toContain('data-cd-role="diag-last-error"')
    expect(markup).toContain('data-cd-role="diag-worker-extraction"')
    expect(markup).toContain('data-cd-role="diag-worker-dream"')
    expect(markup).toContain('data-cd-role="diag-worker-recovery"')
    // Should show "No recent activity" when breadcrumbs are empty
    expect(markup).not.toContain('data-cd-role="diag-breadcrumbs"')
  })

  test('renders diagnostics with populated hook and error info', () => {
    const diag: DiagnosticsSnapshot = {
      ...createDefaultDiagnosticsSnapshot(),
      lastHookKind: 'beforeRequest',
      lastHookTs: 1700000000000,
      lastErrorMessage: 'connection timeout',
      lastErrorTs: 1700000100000,
      extraction: { health: 'ok', lastTs: 1700000200000, lastDetail: 'applied=true' },
      dream: { health: 'error', lastTs: 1700000300000, lastDetail: 'network fail' },
      recovery: { health: 'ok', lastTs: 1700000400000 },
    }

    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
      memoryOpsStatus: { ...createDefaultMemoryOpsStatus(), diagnostics: diag },
    })

    expect(markup).toContain('beforeRequest')
    expect(markup).toContain('connection timeout')
    expect(markup).toContain('applied=true')
    expect(markup).toContain('network fail')
    expect(markup).toContain('data-kind="success"')
    expect(markup).toContain('data-kind="error"')
  })

  test('renders breadcrumbs when present', () => {
    const diag: DiagnosticsSnapshot = {
      ...createDefaultDiagnosticsSnapshot(),
      breadcrumbs: [
        { ts: 1700000000000, label: 'hook:beforeRequest', detail: 'normal' },
        { ts: 1700000001000, label: 'error:preRequest', detail: 'timeout' },
      ],
    }

    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
      memoryOpsStatus: { ...createDefaultMemoryOpsStatus(), diagnostics: diag },
    })

    expect(markup).toContain('data-cd-role="diag-breadcrumbs"')
    expect(markup).toContain('hook:beforeRequest')
    expect(markup).toContain('error:preRequest')
    expect(markup).toContain('timeout')
  })

  test('renders diagnostics labels in Korean when locale is ko', () => {
    setLocale('ko')
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
      memoryOpsStatus: createDefaultMemoryOpsStatus(),
    })

    expect(markup).toContain('런타임 진단')
    expect(markup).toContain('마지막 훅')
    expect(markup).toContain('마지막 오류')
    expect(markup).toContain('추출 워커')
    expect(markup).toContain('통합 워커')
    expect(markup).toContain('시작 복구')
  })

  // ── Dead dashboard action buttons ───────────────────────────────────

  test('renders sidebar close-dashboard, export-settings, and import-settings action buttons', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'general',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
    })

    expect(markup).toContain('data-cd-action="close-dashboard"')
    expect(markup).toContain('data-cd-action="export-settings"')
    expect(markup).toContain('data-cd-action="import-settings"')
  })

  test('renders settings page save-settings and reset-settings action buttons', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'general',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
    })

    expect(markup).toContain('data-cd-action="save-settings"')
    expect(markup).toContain('data-cd-action="reset-settings"')
  })

  // ── Accessibility: aria-label coverage ─────────────────────────────

  test('memory filter input has aria-label', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
    })

    expect(markup).toMatch(/data-cd-role="memory-filter"[^>]*aria-label="[^"]+"/);
  })

  test('add-row inputs have aria-labels', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
    })

    const addRoles = [
      'add-summary-text',
      'add-fact-text',
      'add-world-fact-text',
      'add-entity-name',
      'add-relation-source',
      'add-relation-label',
      'add-relation-target',
    ]
    for (const role of addRoles) {
      expect(markup, `aria-label on ${role}`).toMatch(
        new RegExp(`data-cd-role="${role}"[^>]*aria-label="[^"]+"`)
      )
    }
  })

  test('memory selection checkboxes have aria-labels', () => {
    const state = createEmptyState()
    state.memory.summaries.push({ id: 's1', text: 'a', recencyWeight: 1, updatedAt: 1 })
    state.memory.continuityFacts.push({ id: 'f1', text: 'b', priority: 5 })

    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: state,
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
    })

    expect(markup).toMatch(/data-cd-role="memory-select"[^>]*aria-label="[^"]+"/);
  })

  test('memory item edit and delete buttons have aria-labels', () => {
    const state = createEmptyState()
    state.memory.summaries.push({ id: 's1', text: 'summary one', recencyWeight: 1, updatedAt: 1 })

    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: state,
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
    })

    expect(markup).toMatch(/data-cd-action="edit-memory-item"[^>]*aria-label="[^"]+"/);
    expect(markup).toMatch(/data-cd-action="delete-summary"[^>]*aria-label="[^"]+"/);
  })

  test('close-dashboard button has aria-label', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'general',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
    })

    expect(markup).toMatch(/data-cd-action="close-dashboard"[^>]*aria-label="[^"]+"/);
  })

  test('connection-status surface has role="status" and aria-live="polite"', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'general',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: 'Not tested' },
    })

    expect(markup).toMatch(/cd-connection-status[^>]*role="status"/);
    expect(markup).toMatch(/cd-connection-status[^>]*aria-live="polite"/);
  })
})

// ---------------------------------------------------------------------------
// buildPageTitle helper
// ---------------------------------------------------------------------------

describe('buildPageTitle', () => {
  afterEach(() => {
    setLocale('en')
  })

  test('returns an h2 with cd-page-title class and translated label', () => {
    const html = buildPageTitle('memory-cache')
    expect(html).toBe('<h2 class="cd-page-title">Memory & Cache</h2>')
  })

  test('produces the same title used inside buildDashboardMarkup pages', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'general',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
    })

    for (const tab of DASHBOARD_TABS) {
      expect(markup).toContain(buildPageTitle(tab.id))
    }
  })

  test('respects locale changes', () => {
    setLocale('ko')
    const html = buildPageTitle('memory-cache')
    expect(html).toContain('cd-page-title')
    expect(html).not.toContain('Memory')
  })
})

// ---------------------------------------------------------------------------
// Workbench integration in buildDashboardMarkup
// ---------------------------------------------------------------------------

describe('buildDashboardMarkup – workbench integration', () => {
  afterEach(() => {
    setLocale('en')
  })

  test('renders workbench section when workbenchInput is provided on memory-cache page', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
      workbenchInput: {
        documents: [
          { id: 'doc-1', type: 'character', title: 'Test Doc', source: 'extraction', freshness: 'current', updatedAt: Date.now(), hasEmbedding: true },
        ],
        memoryMdPreview: null,
        notebookSnapshot: null,
        loading: false,
        error: null,
        filters: { type: null, freshness: null, source: null },
      },
    })

    expect(markup).toContain('data-cd-role="workbench-section"')
    expect(markup).toContain('Test Doc')
  })

  test('renders workbench empty state when documents array is empty', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
      workbenchInput: {
        documents: [],
        memoryMdPreview: null,
        notebookSnapshot: null,
        loading: false,
        error: null,
        filters: { type: null, freshness: null, source: null },
      },
    })

    expect(markup).toContain('data-cd-role="workbench-empty"')
  })

  test('does not render workbench section when workbenchInput is not provided', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
    })

    expect(markup).not.toContain('data-cd-role="workbench-section"')
  })

  test('workbench load failure does not break the rest of the memory page', () => {
    const markup = buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'memory-cache',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
      workbenchInput: {
        documents: [],
        memoryMdPreview: null,
        notebookSnapshot: null,
        loading: false,
        error: 'Failed to load memdir documents',
        filters: { type: null, freshness: null, source: null },
      },
    })

    // Workbench error shows inline
    expect(markup).toContain('data-cd-role="workbench-error"')
    expect(markup).toContain('Failed to load memdir documents')
    // Rest of the memory page still renders
    expect(markup).toContain('data-cd-role="memory-empty"')
    expect(markup).toContain('data-cd-action="backfill-current-chat"')
  })
})

// ---------------------------------------------------------------------------
// Progress banner (in-dashboard busy indicator)
// ---------------------------------------------------------------------------

describe('progress banner', () => {
  afterEach(() => {
    setLocale('en')
  })

  function renderMarkup(activeBusyActions?: string[]): string {
    return buildDashboardMarkup({
      settings: normalizePersistedSettings({}),
      pluginState: createEmptyState(),
      profiles: createDefaultProfileManifest(),
      activeTab: 'general',
      modelOptions: ['gpt-4.1-mini'],
      connectionStatus: { kind: 'idle', message: '' },
      ...(activeBusyActions ? { activeBusyActions } : {}),
    })
  }

  test('banner container exists with stable data-cd-role and ARIA hooks', () => {
    const markup = renderMarkup()
    expect(markup).toContain('data-cd-role="progress-banner"')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
  })

  test('banner is empty when no long-running action is active', () => {
    const markup = renderMarkup()
    // Banner container exists but has no visible label text inside
    expect(markup).toContain('data-cd-role="progress-banner"')
    // The banner should render as empty (no text content between tags)
    expect(markup).toMatch(/data-cd-role="progress-banner"[^>]*><\/div>/)
  })

  test('banner is empty when only short actions are active', () => {
    const markup = renderMarkup(['save', 'discard'])
    expect(markup).toContain('data-cd-role="progress-banner"')
    // Should not contain any long-running action text
    expect(markup).not.toContain('Extracting')
    expect(markup).not.toContain('Testing')
    expect(markup).not.toContain('Refreshing')
  })

  test('banner shows correct text for force-extract', () => {
    const markup = renderMarkup(['force-extract'])
    expect(markup).toContain('Extracting memories')
  })

  test('banner shows correct text for backfill-current-chat', () => {
    const markup = renderMarkup(['backfill-current-chat'])
    expect(markup).toContain('Extracting current chat')
  })

  test('banner shows correct text for regenerate-current-chat', () => {
    const markup = renderMarkup(['regenerate-current-chat'])
    expect(markup).toContain('Regenerating from current chat')
  })

  test('banner shows correct text for refresh-embeddings', () => {
    const markup = renderMarkup(['refresh-embeddings'])
    expect(markup).toContain('Refreshing embeddings')
  })

  test('banner shows correct text for test-connection', () => {
    const markup = renderMarkup(['test-connection'])
    expect(markup).toContain('Testing connection')
  })

  test('banner shows correct text for refresh-models', () => {
    const markup = renderMarkup(['refresh-models'])
    expect(markup).toContain('Refreshing model list')
  })

  test('banner shows text in Korean when locale is ko', () => {
    setLocale('ko')
    const markup = renderMarkup(['force-extract'])
    expect(markup).toContain('메모리 추출 중')
  })
})

