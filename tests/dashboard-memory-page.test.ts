/**
 * @vitest-environment jsdom
 *
 * Failing tests for the memory-cache page UI slice.
 *
 * These tests describe the target behavior for an upgraded
 * `buildMemoryCachePage()` that renders live canonical memory state
 * (summaries, continuity facts) with filter input and delete buttons.
 *
 * All tests are expected to FAIL against the current stub implementation.
 */
import { beforeEach, afterEach } from 'vitest'
import { createMockRisuaiApi } from './helpers/mockRisuai.js'
import { openDashboard, closeDashboard } from '../src/ui/dashboardApp.js'
import type { DashboardStore } from '../src/ui/dashboardApp.js'
import { DASHBOARD_ROOT_CLASS } from '../src/ui/dashboardCss.js'
import { createEmptyState } from '../src/contracts/types.js'
import type { DirectorPluginState } from '../src/contracts/types.js'
import { DIRECTOR_STATE_STORAGE_KEY } from '../src/memory/canonicalStore.js'
import { setLocale } from '../src/ui/i18n.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestStore(api: ReturnType<typeof createMockRisuaiApi>): DashboardStore {
  return { storage: api.pluginStorage }
}

/** Build a DirectorPluginState with sample memory data. */
function stateWithMemory(): DirectorPluginState {
  const state = createEmptyState()
  state.memory.summaries = [
    { id: 'sum-1', text: 'The hero crossed the river at dawn.', recencyWeight: 1, updatedAt: 1000 },
    { id: 'sum-2', text: 'A dragon was spotted near the village.', recencyWeight: 0.8, updatedAt: 2000 },
  ]
  state.memory.continuityFacts = [
    { id: 'cf-1', text: 'The hero carries a silver sword.', priority: 10 },
    { id: 'cf-2', text: 'It is currently nighttime.', priority: 5 },
  ]
  return state
}

function navigateToMemoryTab(root: HTMLElement): void {
  const memBtn = root.querySelector('[data-da-target="memory-cache"]') as HTMLElement
  memBtn.click()
}

// ---------------------------------------------------------------------------
// 1. Dashboard DOM rendering — memory-cache page content
// ---------------------------------------------------------------------------

describe('memory-cache page DOM rendering', () => {
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

  test('memory-cache page renders summary items from pluginState.memory.summaries', async () => {
    const state = stateWithMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement

    expect(memoryPage.textContent).toContain('The hero crossed the river at dawn.')
    expect(memoryPage.textContent).toContain('A dragon was spotted near the village.')
  })

  test('memory-cache page renders continuity fact items from pluginState.memory.continuityFacts', async () => {
    const state = stateWithMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement

    expect(memoryPage.textContent).toContain('The hero carries a silver sword.')
    expect(memoryPage.textContent).toContain('It is currently nighttime.')
  })

  test('memory-cache page renders a text filter input', async () => {
    const state = stateWithMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement
    const filterInput = memoryPage.querySelector('input[data-da-role="memory-filter"]') as HTMLInputElement

    expect(filterInput).not.toBeNull()
    expect(filterInput.type).toBe('text')
  })

  test('memory-cache page renders delete buttons carrying summary item ids', async () => {
    const state = stateWithMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement

    const delBtn1 = memoryPage.querySelector('[data-da-action="delete-summary"][data-da-item-id="sum-1"]')
    const delBtn2 = memoryPage.querySelector('[data-da-action="delete-summary"][data-da-item-id="sum-2"]')
    expect(delBtn1).not.toBeNull()
    expect(delBtn2).not.toBeNull()
  })

  test('memory-cache page renders delete buttons carrying continuity fact item ids', async () => {
    const state = stateWithMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement

    const delBtn1 = memoryPage.querySelector('[data-da-action="delete-continuity-fact"][data-da-item-id="cf-1"]')
    const delBtn2 = memoryPage.querySelector('[data-da-action="delete-continuity-fact"][data-da-item-id="cf-2"]')
    expect(delBtn1).not.toBeNull()
    expect(delBtn2).not.toBeNull()
  })

  test('empty memory renders a specific empty-state hint instead of only the old placeholder copy', async () => {
    // Open dashboard with default empty state (no summaries/continuityFacts)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement

    // The new empty state hint element should be present
    const emptyHint = memoryPage.querySelector('[data-da-role="memory-empty"]')
    expect(emptyHint).not.toBeNull()

    // Should NOT contain only the old placeholder hint text
    // (The old hint said "Memory summaries, entity graphs, and cache controls will appear here.")
    // The new empty state should have a distinct, actionable message
    expect(emptyHint?.textContent).toBeTruthy()
    expect(emptyHint?.textContent).not.toBe('')
  })

  test('memory-cache page escapes memory text and item ids before injecting HTML', async () => {
    const state = createEmptyState()
    state.memory.summaries = [
      {
        id: 'sum-"quoted"',
        text: 'Unsafe <strong>summary</strong> & "quotes"',
        recencyWeight: 1,
        updatedAt: 1000,
      },
    ]
    state.memory.continuityFacts = [
      {
        id: 'cf-"quoted"',
        text: 'Unsafe <img src=x onerror="boom"> fact',
        priority: 5,
      },
    ]

    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement

    expect(memoryPage.querySelector('strong')).toBeNull()
    expect(memoryPage.querySelector('img')).toBeNull()

    const renderedTexts = Array.from(memoryPage.querySelectorAll('.da-memory-item span')).map(
      (node) => node.textContent,
    )
    expect(renderedTexts).toContain('Unsafe <strong>summary</strong> & "quotes"')
    expect(renderedTexts).toContain('Unsafe <img src=x onerror="boom"> fact')

    const summaryDelete = memoryPage.querySelector(
      '[data-da-action="delete-summary"]',
    ) as HTMLElement | null
    const factDelete = memoryPage.querySelector(
      '[data-da-action="delete-continuity-fact"]',
    ) as HTMLElement | null
    expect(summaryDelete?.getAttribute('data-da-item-id')).toBe('sum-"quoted"')
    expect(factDelete?.getAttribute('data-da-item-id')).toBe('cf-"quoted"')
  })
})

// ---------------------------------------------------------------------------
// 2. Dashboard app — live canonical state via DashboardStore read accessor
// ---------------------------------------------------------------------------

describe('dashboard app live canonical state', () => {
  let api: ReturnType<typeof createMockRisuaiApi>
  let store: DashboardStore

  beforeEach(() => {
    api = createMockRisuaiApi()
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

  test('opening the dashboard with a CanonicalStore-backed read accessor shows summary items on memory-cache tab', async () => {
    const state = stateWithMemory()

    // Provide a DashboardStore with a readCanonical accessor that returns
    // the live canonical state snapshot.
    store = {
      storage: api.pluginStorage,
      readCanonical: async () => state,
    } as DashboardStore & { readCanonical: () => Promise<DirectorPluginState> }

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement

    expect(memoryPage.textContent).toContain('The hero crossed the river at dawn.')
    expect(memoryPage.textContent).toContain('A dragon was spotted near the village.')
  })

  test('opening the dashboard with a CanonicalStore-backed read accessor shows continuity fact items on memory-cache tab', async () => {
    const state = stateWithMemory()

    store = {
      storage: api.pluginStorage,
      readCanonical: async () => state,
    } as DashboardStore & { readCanonical: () => Promise<DirectorPluginState> }

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement

    expect(memoryPage.textContent).toContain('The hero carries a silver sword.')
    expect(memoryPage.textContent).toContain('It is currently nighttime.')
  })
})

// ---------------------------------------------------------------------------
// 3. Dashboard app delete actions
// ---------------------------------------------------------------------------

describe('dashboard app memory delete actions', () => {
  let api: ReturnType<typeof createMockRisuaiApi>
  let store: DashboardStore

  beforeEach(() => {
    api = createMockRisuaiApi()
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

  test('clicking delete-summary removes the summary and re-renders', async () => {
    const state = stateWithMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)

    store = {
      storage: api.pluginStorage,
      readCanonical: async () => {
        const raw = await api.pluginStorage.getItem<DirectorPluginState>(DIRECTOR_STATE_STORAGE_KEY)
        return raw ?? createEmptyState()
      },
    } as DashboardStore & { readCanonical: () => Promise<DirectorPluginState> }

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    // Click delete on sum-1
    const delBtn = root.querySelector('[data-da-action="delete-summary"][data-da-item-id="sum-1"]') as HTMLElement
    expect(delBtn).not.toBeNull()
    delBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    // After re-render, sum-1 should be gone
    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement
    expect(memoryPage.textContent).not.toContain('The hero crossed the river at dawn.')
    // sum-2 should still be present
    expect(memoryPage.textContent).toContain('A dragon was spotted near the village.')
  })

  test('clicking delete-continuity-fact removes the fact and re-renders', async () => {
    const state = stateWithMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)

    store = {
      storage: api.pluginStorage,
      readCanonical: async () => {
        const raw = await api.pluginStorage.getItem<DirectorPluginState>(DIRECTOR_STATE_STORAGE_KEY)
        return raw ?? createEmptyState()
      },
    } as DashboardStore & { readCanonical: () => Promise<DirectorPluginState> }

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    // Click delete on cf-1
    const delBtn = root.querySelector('[data-da-action="delete-continuity-fact"][data-da-item-id="cf-1"]') as HTMLElement
    expect(delBtn).not.toBeNull()
    delBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    // After re-render, cf-1 should be gone
    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement
    expect(memoryPage.textContent).not.toContain('The hero carries a silver sword.')
    // cf-2 should still be present
    expect(memoryPage.textContent).toContain('It is currently nighttime.')
  })

  test('clicking delete-summary uses writeCanonical when provided', async () => {
    let currentState = stateWithMemory()
    let writeCalls = 0

    store = {
      storage: api.pluginStorage,
      readCanonical: async () => currentState,
      writeCanonical: async (mutator) => {
        writeCalls += 1
        currentState = mutator(structuredClone(currentState))
        return currentState
      },
    } as DashboardStore & {
      readCanonical: () => Promise<DirectorPluginState>
      writeCanonical: (
        mutator: (state: DirectorPluginState) => DirectorPluginState,
      ) => Promise<DirectorPluginState>
    }

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const delBtn = root.querySelector(
      '[data-da-action="delete-summary"][data-da-item-id="sum-1"]',
    ) as HTMLElement
    expect(delBtn).not.toBeNull()
    delBtn.click()
    await new Promise((r) => {
      setTimeout(r, 50)
    })

    expect(writeCalls).toBe(1)
    expect(currentState.memory.summaries.some((entry) => entry.id === 'sum-1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 4. Dashboard app memory add actions
// ---------------------------------------------------------------------------

describe('dashboard app memory add actions', () => {
  let api: ReturnType<typeof createMockRisuaiApi>
  let store: DashboardStore

  beforeEach(() => {
    api = createMockRisuaiApi()
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

  test('add-summary button and input render in the summaries card', async () => {
    const state = stateWithMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store = createTestStore(api))
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const memoryPage = document.querySelector('#da-page-memory-cache') as HTMLElement
    const addBtn = memoryPage.querySelector('[data-da-action="add-summary"]')
    const addInput = memoryPage.querySelector('input[data-da-role="add-summary-text"]') as HTMLInputElement
    expect(addBtn).not.toBeNull()
    expect(addInput).not.toBeNull()
    expect(addInput.type).toBe('text')
  })

  test('add-continuity-fact button and input render in the continuity facts card', async () => {
    const state = stateWithMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store = createTestStore(api))
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const memoryPage = document.querySelector('#da-page-memory-cache') as HTMLElement
    const addBtn = memoryPage.querySelector('[data-da-action="add-continuity-fact"]')
    const addInput = memoryPage.querySelector('input[data-da-role="add-fact-text"]') as HTMLInputElement
    expect(addBtn).not.toBeNull()
    expect(addInput).not.toBeNull()
    expect(addInput.type).toBe('text')
  })

  test('add controls render even when memory is empty', async () => {
    await openDashboard(api, store = createTestStore(api))
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const memoryPage = document.querySelector('#da-page-memory-cache') as HTMLElement
    const addSummaryBtn = memoryPage.querySelector('[data-da-action="add-summary"]')
    const addFactBtn = memoryPage.querySelector('[data-da-action="add-continuity-fact"]')
    const addSummaryInput = memoryPage.querySelector('input[data-da-role="add-summary-text"]')
    const addFactInput = memoryPage.querySelector('input[data-da-role="add-fact-text"]')
    expect(addSummaryBtn).not.toBeNull()
    expect(addFactBtn).not.toBeNull()
    expect(addSummaryInput).not.toBeNull()
    expect(addFactInput).not.toBeNull()
  })

  test('add-summary creates a new summary and re-renders it', async () => {
    const state = stateWithMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    store = {
      storage: api.pluginStorage,
      readCanonical: async () => {
        const raw = await api.pluginStorage.getItem<DirectorPluginState>(DIRECTOR_STATE_STORAGE_KEY)
        return raw ?? createEmptyState()
      },
    }

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const addInput = root.querySelector('input[data-da-role="add-summary-text"]') as HTMLInputElement
    addInput.value = 'Newly added summary text'
    const addBtn = root.querySelector('[data-da-action="add-summary"]') as HTMLElement
    addBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const memoryPage = document.querySelector('#da-page-memory-cache') as HTMLElement
    expect(memoryPage.textContent).toContain('Newly added summary text')
  })

  test('add-continuity-fact creates a new fact and re-renders it', async () => {
    const state = stateWithMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    store = {
      storage: api.pluginStorage,
      readCanonical: async () => {
        const raw = await api.pluginStorage.getItem<DirectorPluginState>(DIRECTOR_STATE_STORAGE_KEY)
        return raw ?? createEmptyState()
      },
    }

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const addInput = root.querySelector('input[data-da-role="add-fact-text"]') as HTMLInputElement
    addInput.value = 'Newly added continuity fact'
    const addBtn = root.querySelector('[data-da-action="add-continuity-fact"]') as HTMLElement
    addBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const memoryPage = document.querySelector('#da-page-memory-cache') as HTMLElement
    expect(memoryPage.textContent).toContain('Newly added continuity fact')
  })

  test('add-summary with empty text does nothing', async () => {
    const state = stateWithMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    store = {
      storage: api.pluginStorage,
      readCanonical: async () => {
        const raw = await api.pluginStorage.getItem<DirectorPluginState>(DIRECTOR_STATE_STORAGE_KEY)
        return raw ?? createEmptyState()
      },
    }

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const summaryCountBefore = root.querySelectorAll('[data-da-action="delete-summary"]').length
    const addInput = root.querySelector('input[data-da-role="add-summary-text"]') as HTMLInputElement
    addInput.value = '   '
    const addBtn = root.querySelector('[data-da-action="add-summary"]') as HTMLElement
    addBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const summaryCountAfter = document.querySelectorAll('[data-da-action="delete-summary"]').length
    expect(summaryCountAfter).toBe(summaryCountBefore)
  })

  test('add-summary uses writeCanonical when provided', async () => {
    let currentState = stateWithMemory()
    let writeCalls = 0

    store = {
      storage: api.pluginStorage,
      readCanonical: async () => currentState,
      writeCanonical: async (mutator) => {
        writeCalls += 1
        currentState = mutator(structuredClone(currentState))
        return currentState
      },
    }

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const addInput = root.querySelector('input[data-da-role="add-summary-text"]') as HTMLInputElement
    addInput.value = 'Written via writeCanonical'
    const addBtn = root.querySelector('[data-da-action="add-summary"]') as HTMLElement
    addBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    expect(writeCalls).toBe(1)
    expect(currentState.memory.summaries.some((s) => s.text === 'Written via writeCanonical')).toBe(true)
  })

  test('created summary gets sensible defaults (truthy id, recencyWeight 1, recent updatedAt)', async () => {
    let currentState = createEmptyState()

    store = {
      storage: api.pluginStorage,
      readCanonical: async () => currentState,
      writeCanonical: async (mutator) => {
        currentState = mutator(structuredClone(currentState))
        return currentState
      },
    }

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const addInput = root.querySelector('input[data-da-role="add-summary-text"]') as HTMLInputElement
    addInput.value = 'Default check summary'
    const addBtn = root.querySelector('[data-da-action="add-summary"]') as HTMLElement
    addBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const created = currentState.memory.summaries.find((s) => s.text === 'Default check summary')
    expect(created).toBeDefined()
    expect(created!.id).toBeTruthy()
    expect(created!.recencyWeight).toBe(1)
    expect(created!.updatedAt).toBeGreaterThan(Date.now() - 5000)
  })

  test('created continuity fact gets sensible defaults and syncs to director.continuityFacts', async () => {
    let currentState = createEmptyState()

    store = {
      storage: api.pluginStorage,
      readCanonical: async () => currentState,
      writeCanonical: async (mutator) => {
        currentState = mutator(structuredClone(currentState))
        return currentState
      },
    }

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const addInput = root.querySelector('input[data-da-role="add-fact-text"]') as HTMLInputElement
    addInput.value = 'Default check fact'
    const addBtn = root.querySelector('[data-da-action="add-continuity-fact"]') as HTMLElement
    addBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const inMemory = currentState.memory.continuityFacts.find((f) => f.text === 'Default check fact')
    const inDirector = currentState.director.continuityFacts.find((f) => f.text === 'Default check fact')
    expect(inMemory).toBeDefined()
    expect(inDirector).toBeDefined()
    expect(inMemory!.id).toBeTruthy()
    expect(inMemory!.priority).toBe(5)
    expect(inMemory!.id).toBe(inDirector!.id)
  })
})

// ---------------------------------------------------------------------------
// 5. Localization — Korean locale for memory page surface
// ---------------------------------------------------------------------------

describe('memory-cache page Korean localization', () => {
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
    setLocale('en')
  })

  test('Korean locale renders translated section headings for summaries and continuity facts', async () => {
    setLocale('ko')
    const state = stateWithMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)

    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement
    const text = memoryPage.textContent ?? ''

    // Should NOT contain English section labels
    expect(text).not.toContain('Summaries')
    expect(text).not.toContain('Continuity Facts')

    // Should contain Korean labels (the exact strings will be driven by
    // the i18n catalog keys added during implementation, e.g.
    // 'card.memorySummaries.title' → '요약' and
    // 'card.continuityFacts.title' → '연속성 사실')
    // For now we just assert that some non-English, non-empty heading text exists
    // by checking the page renders the memory data (items are language-agnostic)
    // AND does not fall back to English labels.
    expect(memoryPage.querySelectorAll('.da-card-title').length).toBeGreaterThanOrEqual(2)
  })

  test('Korean locale renders translated delete button labels', async () => {
    setLocale('ko')
    const state = stateWithMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)

    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement

    // Delete buttons should exist and should NOT contain English "Delete" text
    const deleteButtons = memoryPage.querySelectorAll('[data-da-action="delete-summary"], [data-da-action="delete-continuity-fact"]')
    expect(deleteButtons.length).toBeGreaterThan(0)

    for (const btn of deleteButtons) {
      expect(btn.textContent).not.toBe('Delete')
    }
  })

  test('Korean locale renders translated filter placeholder', async () => {
    setLocale('ko')
    const state = stateWithMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)

    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement
    const filterInput = memoryPage.querySelector('input[data-da-role="memory-filter"]') as HTMLInputElement

    expect(filterInput).not.toBeNull()
    // Placeholder should be in Korean, not English
    expect(filterInput.placeholder).toBeTruthy()
    expect(filterInput.placeholder).not.toBe('Filter memory…')
  })

  test('Korean locale renders translated add button labels and placeholders', async () => {
    setLocale('ko')
    const state = stateWithMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)

    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement

    const addSummaryBtn = memoryPage.querySelector('[data-da-action="add-summary"]') as HTMLElement
    const addFactBtn = memoryPage.querySelector('[data-da-action="add-continuity-fact"]') as HTMLElement
    expect(addSummaryBtn).not.toBeNull()
    expect(addFactBtn).not.toBeNull()
    // Should not be English
    expect(addSummaryBtn.textContent).not.toBe('Add')
    expect(addFactBtn.textContent).not.toBe('Add')

    const summaryInput = memoryPage.querySelector('input[data-da-role="add-summary-text"]') as HTMLInputElement
    const factInput = memoryPage.querySelector('input[data-da-role="add-fact-text"]') as HTMLInputElement
    expect(summaryInput.placeholder).toBeTruthy()
    expect(summaryInput.placeholder).not.toBe('New summary text\u2026')
    expect(factInput.placeholder).toBeTruthy()
    expect(factInput.placeholder).not.toBe('New continuity fact\u2026')
  })

  test('Korean locale renders translated empty-state hint', async () => {
    setLocale('ko')
    // Use default empty state (no memory items)
    await openDashboard(api, store)

    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement
    const emptyHint = memoryPage.querySelector('[data-da-role="memory-empty"]')

    expect(emptyHint).not.toBeNull()
    // Should be non-empty Korean text, not the English version
    expect(emptyHint?.textContent).toBeTruthy()
  })
})
