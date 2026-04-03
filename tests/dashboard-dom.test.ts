import { createEmptyState } from '../src/contracts/types.js'
import { DEFAULT_DIRECTOR_PROMPT_PRESET } from '../src/director/prompt.js'
import {
  buildDashboardMarkup,
  DASHBOARD_TABS
} from '../src/ui/dashboardDom.js'
import {
  createDefaultProfileManifest,
  normalizePersistedSettings
} from '../src/ui/dashboardState.js'
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
      expect(markup).toContain(`data-da-target="${tab.id}"`)
      expect(markup).toContain(`id="da-page-${tab.id}"`)
    }

    expect(markup).toContain('Director Dashboard')
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

    expect(markup).toContain('data-da-role="prompt-preset-select"')
    expect(markup).toContain('data-da-role="prompt-preset-name"')
    expect(markup).toContain('data-da-role="prompt-pre-request-system"')
    expect(markup).toContain('data-da-role="prompt-post-response-user"')
    expect(markup).toContain('data-da-action="create-prompt-preset"')
    expect(markup).toContain(DEFAULT_DIRECTOR_PROMPT_PRESET.preRequestSystemTemplate.slice(0, 32))
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
    expect(markup).toContain('data-da-field="embeddingProvider"')
    expect(markup).toContain('data-da-field="embeddingBaseUrl"')
    expect(markup).toContain('data-da-field="embeddingApiKey"')
    expect(markup).toContain('data-da-field="embeddingModel"')
    expect(markup).toContain('data-da-field="embeddingDimensions"')
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

    expect(markup).toContain('data-da-action="backfill-current-chat"')
    expect(markup).toContain('data-da-action="regenerate-current-chat"')
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
      },
    })

    expect(markup).toContain('data-da-role="memory-ops-status"')
    expect(markup).toContain('data-da-action="force-extract"')
    expect(markup).toContain('data-da-action="force-dream"')
    expect(markup).toContain('data-da-action="inspect-recalled"')
    expect(markup).toContain('data-da-action="toggle-fallback-retrieval"')
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
      },
    })

    expect(markup).toContain('data-da-role="stale-warnings"')
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
      },
    })

    expect(markup).toContain('data-da-role="memory-locked"')
  })
})
