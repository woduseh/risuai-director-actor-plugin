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
import { beforeEach, afterEach, vi } from 'vitest'
import { createMockRisuaiApi } from './helpers/mockRisuai.js'
import { openDashboard, closeDashboard, ARM_TIMEOUT_MS } from '../src/ui/dashboardApp.js'
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

  test('memory-cache page renders selection checkboxes and a disabled bulk delete action', async () => {
    const state = stateWithFullMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement
    const checkboxes = memoryPage.querySelectorAll('input[data-da-role="memory-select"]')
    const bulkDeleteBtn = memoryPage.querySelector('[data-da-action="bulk-delete-memory"]') as HTMLButtonElement

    expect(checkboxes.length).toBeGreaterThan(0)
    expect(bulkDeleteBtn).not.toBeNull()
    expect(bulkDeleteBtn.disabled).toBe(true)
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

    // Ensure user-supplied memory text is escaped — dangerous tags must NOT
    // appear as real DOM elements inside memory items (the ops status card
    // legitimately uses <strong> so we scope the check to .da-memory-list).
    const memoryLists = memoryPage.querySelectorAll('.da-memory-list')
    for (const list of Array.from(memoryLists)) {
      expect(list.querySelector('strong')).toBeNull()
      expect(list.querySelector('img')).toBeNull()
    }

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

    // Click delete on sum-1 (first click arms, second confirms)
    const delBtn = root.querySelector('[data-da-action="delete-summary"][data-da-item-id="sum-1"]') as HTMLElement
    expect(delBtn).not.toBeNull()
    delBtn.click()
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

    // Click delete on cf-1 (first click arms, second confirms)
    const delBtn = root.querySelector('[data-da-action="delete-continuity-fact"][data-da-item-id="cf-1"]') as HTMLElement
    expect(delBtn).not.toBeNull()
    delBtn.click()
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
    delBtn.click() // arm
    delBtn.click() // confirm
    await new Promise((r) => {
      setTimeout(r, 50)
    })

    expect(writeCalls).toBe(1)
    expect(currentState.memory.summaries.some((entry) => entry.id === 'sum-1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 4. Dashboard app memory edit + bulk delete actions
// ---------------------------------------------------------------------------

describe('dashboard app memory edit and bulk delete actions', () => {
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

  test('bulk delete removes selected memory items across domains and re-renders', async () => {
    let currentState = stateWithFullMemory()
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

    const summaryCheckbox = root.querySelector(
      'input[data-da-role="memory-select"][data-da-item-key="summary:sum-1"]',
    ) as HTMLInputElement
    const entityCheckbox = root.querySelector(
      'input[data-da-role="memory-select"][data-da-item-key="entity:ent-1"]',
    ) as HTMLInputElement
    summaryCheckbox.checked = true
    summaryCheckbox.dispatchEvent(new Event('change', { bubbles: true }))
    entityCheckbox.checked = true
    entityCheckbox.dispatchEvent(new Event('change', { bubbles: true }))

    const bulkDeleteBtn = root.querySelector('[data-da-action="bulk-delete-memory"]') as HTMLButtonElement
    expect(bulkDeleteBtn.disabled).toBe(false)
    bulkDeleteBtn.click() // arm
    bulkDeleteBtn.click() // confirm
    await new Promise((r) => { setTimeout(r, 50) })

    const memoryPage = document.querySelector('#da-page-memory-cache') as HTMLElement
    expect(memoryPage.textContent).not.toContain('The hero crossed the river at dawn.')
    expect(memoryPage.textContent).not.toContain('Aldric')
    expect(currentState.memory.summaries.some((entry) => entry.id === 'sum-1')).toBe(false)
    expect(currentState.memory.entities.some((entry) => entry.id === 'ent-1')).toBe(false)
  })

  test('editing a summary updates its text and re-renders the row', async () => {
    let currentState = stateWithMemory()
    store = {
      storage: api.pluginStorage,
      readCanonical: async () => currentState,
      writeCanonical: async (mutator) => {
        currentState = mutator(structuredClone(currentState))
        return currentState
      },
    }

    await openDashboard(api, store)
    let root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const editBtn = root.querySelector(
      '[data-da-action="edit-memory-item"][data-da-item-key="summary:sum-1"]',
    ) as HTMLElement
    expect(editBtn).not.toBeNull()
    editBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const editInput = root.querySelector(
      'input[data-da-role="edit-summary-text"][data-da-item-id="sum-1"]',
    ) as HTMLInputElement
    expect(editInput).not.toBeNull()
    editInput.value = 'The hero crossed the desert at noon.'
    editInput.dispatchEvent(new Event('input', { bubbles: true }))

    const saveBtn = root.querySelector(
      '[data-da-action="save-memory-edit"][data-da-item-key="summary:sum-1"]',
    ) as HTMLElement
    saveBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const memoryPage = document.querySelector('#da-page-memory-cache') as HTMLElement
    expect(memoryPage.textContent).toContain('The hero crossed the desert at noon.')
    expect(currentState.memory.summaries[0]?.text).toBe('The hero crossed the desert at noon.')
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

// ---------------------------------------------------------------------------
// 5. Memory filter – live filtering of rendered memory items
// ---------------------------------------------------------------------------

describe('memory-cache page filter', () => {
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

  /** Helper: open dashboard, navigate to memory tab, return page + filter. */
  async function openMemoryPage() {
    const state = stateWithMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)
    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement
    const filterInput = memoryPage.querySelector('input[data-da-role="memory-filter"]') as HTMLInputElement
    return { memoryPage, filterInput }
  }

  /** Simulate typing into the filter input. */
  function typeFilter(input: HTMLInputElement, value: string): void {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  test('typing into the filter hides non-matching items', async () => {
    const { memoryPage, filterInput } = await openMemoryPage()

    // All 4 items visible before filtering
    const allItems = memoryPage.querySelectorAll('.da-memory-item')
    expect(allItems.length).toBe(4)

    typeFilter(filterInput, 'dragon')

    const visible = Array.from(memoryPage.querySelectorAll('.da-memory-item'))
      .filter((el) => !el.classList.contains('da-hidden'))
    const hidden = Array.from(memoryPage.querySelectorAll('.da-memory-item'))
      .filter((el) => el.classList.contains('da-hidden'))

    expect(visible.length).toBe(1)
    expect(hidden.length).toBe(3)
    expect(visible[0]).toBeDefined()
    expect(visible[0]?.textContent).toContain('dragon')
  })

  test('clearing the filter restores all items', async () => {
    const { memoryPage, filterInput } = await openMemoryPage()

    typeFilter(filterInput, 'dragon')
    // Verify at least one item is hidden
    expect(
      Array.from(memoryPage.querySelectorAll('.da-memory-item'))
        .some((el) => el.classList.contains('da-hidden')),
    ).toBe(true)

    // Clear the filter
    typeFilter(filterInput, '')

    const allItems = Array.from(memoryPage.querySelectorAll('.da-memory-item'))
    for (const item of allItems) {
      expect(item.classList.contains('da-hidden')).toBe(false)
    }
    expect(allItems.length).toBe(4)
  })

  test('filtering applies across both summaries and continuity facts', async () => {
    const { memoryPage, filterInput } = await openMemoryPage()

    // "sword" appears only in a continuity fact, "river" only in a summary
    typeFilter(filterInput, 'sword')
    let visible = Array.from(memoryPage.querySelectorAll('.da-memory-item'))
      .filter((el) => !el.classList.contains('da-hidden'))
    expect(visible.length).toBe(1)
    expect(visible[0]).toBeDefined()
    expect(visible[0]?.textContent).toContain('silver sword')

    typeFilter(filterInput, 'river')
    visible = Array.from(memoryPage.querySelectorAll('.da-memory-item'))
      .filter((el) => !el.classList.contains('da-hidden'))
    expect(visible.length).toBe(1)
    expect(visible[0]).toBeDefined()
    expect(visible[0]?.textContent).toContain('river')
  })

  test('filtering is case-insensitive', async () => {
    const { memoryPage, filterInput } = await openMemoryPage()

    typeFilter(filterInput, 'DRAGON')
    const visible = Array.from(memoryPage.querySelectorAll('.da-memory-item'))
      .filter((el) => !el.classList.contains('da-hidden'))
    expect(visible.length).toBe(1)
    expect(visible[0]).toBeDefined()
    expect(visible[0]?.textContent).toContain('dragon')
  })

  test('filter applies across world facts, entities, and relations too', async () => {
    const state = stateWithFullMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)
    const memoryPage = root.querySelector('#da-page-memory-cache') as HTMLElement
    const filterInput = memoryPage.querySelector('input[data-da-role="memory-filter"]') as HTMLInputElement

    typeFilter(filterInput, 'Elaria')
    const visible = Array.from(memoryPage.querySelectorAll('.da-memory-item'))
      .filter((el) => !el.classList.contains('da-hidden'))
    expect(visible.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Helper — state with all memory types populated
// ---------------------------------------------------------------------------

function stateWithFullMemory(): DirectorPluginState {
  const state = stateWithMemory()
  state.memory.worldFacts = [
    { id: 'wf-1', text: 'Magic is forbidden in the northern kingdoms.', updatedAt: 1000 },
    { id: 'wf-2', text: 'The river Elaria splits the continent.', updatedAt: 2000 },
  ]
  state.memory.entities = [
    { id: 'ent-1', name: 'Aldric', facts: ['A wandering knight'], tags: ['protagonist'], updatedAt: 1000 },
    { id: 'ent-2', name: 'Mira', facts: ['Village healer'], tags: ['npc'], updatedAt: 2000 },
  ]
  state.memory.relations = [
    { id: 'rel-1', sourceId: 'ent-1', targetId: 'ent-2', label: 'protects', updatedAt: 1000 },
  ]
  return state
}

// ---------------------------------------------------------------------------
// 7. World Facts — render + add + delete
// ---------------------------------------------------------------------------

describe('memory-cache page world facts', () => {
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

  test('world facts section renders with a heading', async () => {
    const state = stateWithFullMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)
    const memoryPage = root.querySelector('#da-page-memory-cache') as HTMLElement

    const titles = Array.from(memoryPage.querySelectorAll('.da-card-title')).map((el) => el.textContent)
    expect(titles).toContain('World Facts')
  })

  test('world facts render as .da-memory-item with text and delete button', async () => {
    const state = stateWithFullMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)
    const memoryPage = root.querySelector('#da-page-memory-cache') as HTMLElement

    expect(memoryPage.textContent).toContain('Magic is forbidden in the northern kingdoms.')
    expect(memoryPage.textContent).toContain('The river Elaria splits the continent.')

    const delBtn1 = memoryPage.querySelector('[data-da-action="delete-world-fact"][data-da-item-id="wf-1"]')
    const delBtn2 = memoryPage.querySelector('[data-da-action="delete-world-fact"][data-da-item-id="wf-2"]')
    expect(delBtn1).not.toBeNull()
    expect(delBtn2).not.toBeNull()
  })

  test('add-world-fact input and button render', async () => {
    const state = stateWithFullMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)
    const memoryPage = root.querySelector('#da-page-memory-cache') as HTMLElement

    const addBtn = memoryPage.querySelector('[data-da-action="add-world-fact"]')
    const addInput = memoryPage.querySelector('input[data-da-role="add-world-fact-text"]') as HTMLInputElement
    expect(addBtn).not.toBeNull()
    expect(addInput).not.toBeNull()
    expect(addInput.type).toBe('text')
  })

  test('clicking add-world-fact creates a world fact and re-renders', async () => {
    let currentState = stateWithFullMemory()
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

    const addInput = root.querySelector('input[data-da-role="add-world-fact-text"]') as HTMLInputElement
    addInput.value = 'Dragons hibernate in winter.'
    const addBtn = root.querySelector('[data-da-action="add-world-fact"]') as HTMLElement
    addBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const memoryPage = document.querySelector('#da-page-memory-cache') as HTMLElement
    expect(memoryPage.textContent).toContain('Dragons hibernate in winter.')
    expect(currentState.memory.worldFacts.some((w) => w.text === 'Dragons hibernate in winter.')).toBe(true)
  })

  test('clicking delete-world-fact removes the fact and re-renders', async () => {
    let currentState = stateWithFullMemory()
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

    const delBtn = root.querySelector('[data-da-action="delete-world-fact"][data-da-item-id="wf-1"]') as HTMLElement
    expect(delBtn).not.toBeNull()
    delBtn.click() // arm
    delBtn.click() // confirm
    await new Promise((r) => { setTimeout(r, 50) })

    const memoryPage = document.querySelector('#da-page-memory-cache') as HTMLElement
    expect(memoryPage.textContent).not.toContain('Magic is forbidden in the northern kingdoms.')
    expect(memoryPage.textContent).toContain('The river Elaria splits the continent.')
  })

  test('delete-world-fact uses writeCanonical when provided', async () => {
    let currentState = stateWithFullMemory()
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

    const delBtn = root.querySelector('[data-da-action="delete-world-fact"][data-da-item-id="wf-1"]') as HTMLElement
    delBtn.click() // arm
    delBtn.click() // confirm
    await new Promise((r) => { setTimeout(r, 50) })

    expect(writeCalls).toBe(1)
    expect(currentState.memory.worldFacts.some((w) => w.id === 'wf-1')).toBe(false)
  })

  test('add-world-fact with empty text does nothing', async () => {
    let currentState = stateWithFullMemory()
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

    const countBefore = currentState.memory.worldFacts.length
    const addInput = root.querySelector('input[data-da-role="add-world-fact-text"]') as HTMLInputElement
    addInput.value = '   '
    const addBtn = root.querySelector('[data-da-action="add-world-fact"]') as HTMLElement
    addBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    expect(currentState.memory.worldFacts.length).toBe(countBefore)
  })
})

// ---------------------------------------------------------------------------
// 8. Entities — render + add + delete
// ---------------------------------------------------------------------------

describe('memory-cache page entities', () => {
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

  test('entities section renders with a heading', async () => {
    const state = stateWithFullMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)
    const memoryPage = root.querySelector('#da-page-memory-cache') as HTMLElement

    const titles = Array.from(memoryPage.querySelectorAll('.da-card-title')).map((el) => el.textContent)
    expect(titles).toContain('Entities')
  })

  test('entities render as .da-memory-item with name and delete button', async () => {
    const state = stateWithFullMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)
    const memoryPage = root.querySelector('#da-page-memory-cache') as HTMLElement

    expect(memoryPage.textContent).toContain('Aldric')
    expect(memoryPage.textContent).toContain('Mira')

    const delBtn1 = memoryPage.querySelector('[data-da-action="delete-entity"][data-da-item-id="ent-1"]')
    const delBtn2 = memoryPage.querySelector('[data-da-action="delete-entity"][data-da-item-id="ent-2"]')
    expect(delBtn1).not.toBeNull()
    expect(delBtn2).not.toBeNull()
  })

  test('add-entity input and button render', async () => {
    const state = stateWithFullMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)
    const memoryPage = root.querySelector('#da-page-memory-cache') as HTMLElement

    const addBtn = memoryPage.querySelector('[data-da-action="add-entity"]')
    const addInput = memoryPage.querySelector('input[data-da-role="add-entity-name"]') as HTMLInputElement
    expect(addBtn).not.toBeNull()
    expect(addInput).not.toBeNull()
    expect(addInput.type).toBe('text')
  })

  test('clicking add-entity creates an entity and re-renders', async () => {
    let currentState = stateWithFullMemory()
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

    const addInput = root.querySelector('input[data-da-role="add-entity-name"]') as HTMLInputElement
    addInput.value = 'Gorath'
    const addBtn = root.querySelector('[data-da-action="add-entity"]') as HTMLElement
    addBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const memoryPage = document.querySelector('#da-page-memory-cache') as HTMLElement
    expect(memoryPage.textContent).toContain('Gorath')
    expect(currentState.memory.entities.some((e) => e.name === 'Gorath')).toBe(true)
  })

  test('clicking delete-entity removes the entity and re-renders', async () => {
    let currentState = stateWithFullMemory()
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

    const delBtn = root.querySelector('[data-da-action="delete-entity"][data-da-item-id="ent-1"]') as HTMLElement
    expect(delBtn).not.toBeNull()
    delBtn.click() // arm
    delBtn.click() // confirm
    await new Promise((r) => { setTimeout(r, 50) })

    const memoryPage = document.querySelector('#da-page-memory-cache') as HTMLElement
    expect(memoryPage.textContent).not.toContain('Aldric')
    expect(memoryPage.textContent).toContain('Mira')
  })

  test('delete-entity uses writeCanonical when provided', async () => {
    let currentState = stateWithFullMemory()
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

    const delBtn = root.querySelector('[data-da-action="delete-entity"][data-da-item-id="ent-1"]') as HTMLElement
    delBtn.click() // arm
    delBtn.click() // confirm
    await new Promise((r) => { setTimeout(r, 50) })

    expect(writeCalls).toBe(1)
    expect(currentState.memory.entities.some((e) => e.id === 'ent-1')).toBe(false)
  })

  test('add-entity with empty name does nothing', async () => {
    let currentState = stateWithFullMemory()
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

    const countBefore = currentState.memory.entities.length
    const addInput = root.querySelector('input[data-da-role="add-entity-name"]') as HTMLInputElement
    addInput.value = '   '
    const addBtn = root.querySelector('[data-da-action="add-entity"]') as HTMLElement
    addBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    expect(currentState.memory.entities.length).toBe(countBefore)
  })
})

// ---------------------------------------------------------------------------
// 9. Relations — render + add + delete
// ---------------------------------------------------------------------------

describe('memory-cache page relations', () => {
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

  test('relations section renders with a heading', async () => {
    const state = stateWithFullMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)
    const memoryPage = root.querySelector('#da-page-memory-cache') as HTMLElement

    const titles = Array.from(memoryPage.querySelectorAll('.da-card-title')).map((el) => el.textContent)
    expect(titles).toContain('Relations')
  })

  test('relations render as .da-memory-item with readable sourceId → label → targetId', async () => {
    const state = stateWithFullMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)
    const memoryPage = root.querySelector('#da-page-memory-cache') as HTMLElement

    // The relation row should contain source, label, and target
    const relationItems = memoryPage.querySelectorAll('[data-da-action="delete-relation"]')
    expect(relationItems.length).toBe(1)

    // The parent .da-memory-item should have readable text
    const relItem = relationItems[0]!.closest('.da-memory-item')
    expect(relItem).not.toBeNull()
    const text = relItem!.textContent ?? ''
    expect(text).toContain('ent-1')
    expect(text).toContain('protects')
    expect(text).toContain('ent-2')
  })

  test('relations render delete buttons with item ids', async () => {
    const state = stateWithFullMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)
    const memoryPage = root.querySelector('#da-page-memory-cache') as HTMLElement

    const delBtn = memoryPage.querySelector('[data-da-action="delete-relation"][data-da-item-id="rel-1"]')
    expect(delBtn).not.toBeNull()
  })

  test('add-relation inputs (sourceId, label, targetId) and button render', async () => {
    const state = stateWithFullMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)
    const memoryPage = root.querySelector('#da-page-memory-cache') as HTMLElement

    const addBtn = memoryPage.querySelector('[data-da-action="add-relation"]')
    const srcInput = memoryPage.querySelector('input[data-da-role="add-relation-source"]') as HTMLInputElement
    const labelInput = memoryPage.querySelector('input[data-da-role="add-relation-label"]') as HTMLInputElement
    const tgtInput = memoryPage.querySelector('input[data-da-role="add-relation-target"]') as HTMLInputElement
    expect(addBtn).not.toBeNull()
    expect(srcInput).not.toBeNull()
    expect(labelInput).not.toBeNull()
    expect(tgtInput).not.toBeNull()
  })

  test('clicking add-relation creates a relation and re-renders', async () => {
    let currentState = stateWithFullMemory()
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

    const srcInput = root.querySelector('input[data-da-role="add-relation-source"]') as HTMLInputElement
    const labelInput = root.querySelector('input[data-da-role="add-relation-label"]') as HTMLInputElement
    const tgtInput = root.querySelector('input[data-da-role="add-relation-target"]') as HTMLInputElement
    srcInput.value = 'ent-2'
    labelInput.value = 'heals'
    tgtInput.value = 'ent-1'
    const addBtn = root.querySelector('[data-da-action="add-relation"]') as HTMLElement
    addBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    const memoryPage = document.querySelector('#da-page-memory-cache') as HTMLElement
    expect(memoryPage.textContent).toContain('heals')
    expect(currentState.memory.relations.some((r) => r.label === 'heals')).toBe(true)
  })

  test('clicking delete-relation removes the relation and re-renders', async () => {
    let currentState = stateWithFullMemory()
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

    const delBtn = root.querySelector('[data-da-action="delete-relation"][data-da-item-id="rel-1"]') as HTMLElement
    expect(delBtn).not.toBeNull()
    delBtn.click() // arm
    delBtn.click() // confirm
    await new Promise((r) => { setTimeout(r, 50) })

    const memoryPage = document.querySelector('#da-page-memory-cache') as HTMLElement
    expect(memoryPage.textContent).not.toContain('protects')
    expect(currentState.memory.relations.length).toBe(0)
  })

  test('delete-relation uses writeCanonical when provided', async () => {
    let currentState = stateWithFullMemory()
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

    const delBtn = root.querySelector('[data-da-action="delete-relation"][data-da-item-id="rel-1"]') as HTMLElement
    delBtn.click() // arm
    delBtn.click() // confirm
    await new Promise((r) => { setTimeout(r, 50) })

    expect(writeCalls).toBe(1)
    expect(currentState.memory.relations.some((r) => r.id === 'rel-1')).toBe(false)
  })

  test('add-relation with any empty field does nothing', async () => {
    let currentState = stateWithFullMemory()
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

    const countBefore = currentState.memory.relations.length
    const srcInput = root.querySelector('input[data-da-role="add-relation-source"]') as HTMLInputElement
    const labelInput = root.querySelector('input[data-da-role="add-relation-label"]') as HTMLInputElement
    const tgtInput = root.querySelector('input[data-da-role="add-relation-target"]') as HTMLInputElement
    srcInput.value = 'ent-1'
    labelInput.value = ''
    tgtInput.value = 'ent-2'
    const addBtn = root.querySelector('[data-da-action="add-relation"]') as HTMLElement
    addBtn.click()
    await new Promise((r) => { setTimeout(r, 50) })

    expect(currentState.memory.relations.length).toBe(countBefore)
  })
})

// ---------------------------------------------------------------------------
// 10. Korean locale for new sections
// ---------------------------------------------------------------------------

describe('memory-cache page Korean locale for world facts, entities, relations', () => {
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

  test('Korean locale renders translated section headings for world facts, entities, relations', async () => {
    setLocale('ko')
    const state = stateWithFullMemory()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)
    const memoryPage = root.querySelector('#da-page-memory-cache') as HTMLElement

    const titles = Array.from(memoryPage.querySelectorAll('.da-card-title')).map((el) => el.textContent)
    expect(titles).not.toContain('World Facts')
    expect(titles).not.toContain('Entities')
    expect(titles).not.toContain('Relations')
    // Should have at least 5 section titles (summaries, continuity, world facts, entities, relations)
    expect(titles.length).toBeGreaterThanOrEqual(5)
  })
})

// ---------------------------------------------------------------------------
// 11. Empty-state hint includes new domains
// ---------------------------------------------------------------------------

describe('memory-cache page empty state with new domains', () => {
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

  test('empty state is hidden when any memory domain has items', async () => {
    const state = createEmptyState()
    state.memory.worldFacts = [
      { id: 'wf-1', text: 'Only a world fact', updatedAt: 1000 },
    ]
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, state)
    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)
    const memoryPage = root.querySelector('#da-page-memory-cache') as HTMLElement

    const emptyHint = memoryPage.querySelector('[data-da-role="memory-empty"]')
    expect(emptyHint).toBeNull()
  })

  test('legacy state missing new memory arrays still renders without crashing', async () => {
    const legacyState = createEmptyState()
    const legacyMemory = legacyState.memory as unknown as Record<string, unknown>
    delete legacyMemory.worldFacts
    delete legacyMemory.entities
    delete legacyMemory.relations

    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, legacyState)
    await openDashboard(api, store)

    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const memoryPage = updatedRoot.querySelector('#da-page-memory-cache') as HTMLElement
    const emptyHint = memoryPage.querySelector('[data-da-role="memory-empty"]')

    expect(emptyHint).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 12. Destructive-action arming (UI-3)
// ---------------------------------------------------------------------------

describe('destructive-action arming', () => {
  let api: ReturnType<typeof createMockRisuaiApi>
  let store: DashboardStore

  beforeEach(() => {
    vi.useFakeTimers()
    api = createMockRisuaiApi()
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    setLocale('en')
  })

  afterEach(async () => {
    vi.useRealTimers()
    await closeDashboard()
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    setLocale('en')
  })

  // -- single memory delete ------------------------------------------------

  test('first click on a memory delete button only arms — no state mutation', async () => {
    let currentState = stateWithMemory()
    const originalSummaryCount = currentState.memory.summaries.length
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

    const delBtn = root.querySelector(
      '[data-da-action="delete-summary"][data-da-item-id="sum-1"]',
    ) as HTMLElement
    delBtn.click() // arm only

    // State must NOT have changed
    expect(currentState.memory.summaries.length).toBe(originalSummaryCount)
    // Button should show confirm text and armed class
    expect(delBtn.classList.contains('da-btn--armed')).toBe(true)
    expect(delBtn.textContent).toBe('Confirm Delete?')
  })

  test('second click on an armed memory delete button executes the deletion', async () => {
    let currentState = stateWithMemory()
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

    const delBtn = root.querySelector(
      '[data-da-action="delete-summary"][data-da-item-id="sum-1"]',
    ) as HTMLElement
    delBtn.click() // arm
    delBtn.click() // confirm

    await vi.advanceTimersByTimeAsync(100)

    expect(currentState.memory.summaries.some((s) => s.id === 'sum-1')).toBe(false)
  })

  test('arming one memory item does not arm a different item', async () => {
    let currentState = stateWithMemory()
    const originalCount = currentState.memory.summaries.length
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

    const delBtn1 = root.querySelector(
      '[data-da-action="delete-summary"][data-da-item-id="sum-1"]',
    ) as HTMLElement
    const delBtn2 = root.querySelector(
      '[data-da-action="delete-summary"][data-da-item-id="sum-2"]',
    ) as HTMLElement

    delBtn1.click() // arm sum-1
    expect(delBtn1.classList.contains('da-btn--armed')).toBe(true)
    expect(delBtn2.classList.contains('da-btn--armed')).toBe(false)

    // Clicking sum-2 arms sum-2 but does NOT confirm sum-1
    delBtn2.click() // arm sum-2

    expect(currentState.memory.summaries.length).toBe(originalCount)
  })

  // -- armed state auto-reset after timeout --------------------------------

  test('armed state auto-resets after timeout without executing', async () => {
    let currentState = stateWithMemory()
    const originalCount = currentState.memory.summaries.length
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

    const delBtn = root.querySelector(
      '[data-da-action="delete-summary"][data-da-item-id="sum-1"]',
    ) as HTMLElement
    delBtn.click() // arm
    expect(delBtn.classList.contains('da-btn--armed')).toBe(true)

    // Advance past the arming timeout
    vi.advanceTimersByTime(ARM_TIMEOUT_MS + 100)

    // Armed state should have cleared
    expect(delBtn.classList.contains('da-btn--armed')).toBe(false)
    expect(delBtn.textContent).not.toBe('Confirm Delete?')
    // State should NOT have mutated
    expect(currentState.memory.summaries.length).toBe(originalCount)
  })

  // -- bulk delete ----------------------------------------------------------

  test('first click on bulk-delete only arms, second click executes', async () => {
    let currentState = stateWithFullMemory()
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

    // Select an item
    const checkbox = root.querySelector(
      'input[data-da-role="memory-select"][data-da-item-key="summary:sum-1"]',
    ) as HTMLInputElement
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))

    const bulkBtn = root.querySelector('[data-da-action="bulk-delete-memory"]') as HTMLButtonElement
    bulkBtn.click() // arm
    expect(bulkBtn.classList.contains('da-btn--armed')).toBe(true)
    expect(currentState.memory.summaries.some((s) => s.id === 'sum-1')).toBe(true)

    bulkBtn.click() // confirm
    await vi.advanceTimersByTimeAsync(100)

    expect(currentState.memory.summaries.some((s) => s.id === 'sum-1')).toBe(false)
  })

  // -- button text restored on early-return handler --------------------------

  test('button text is restored after second click even when handler returns early', async () => {
    let currentState = stateWithFullMemory()
    let guardBlocked = false
    store = {
      storage: api.pluginStorage,
      readCanonical: async () => currentState,
      writeCanonical: async (mutator) => {
        currentState = mutator(structuredClone(currentState))
        return currentState
      },
      checkRefreshGuard: () => ({
        blocked: guardBlocked,
        reason: guardBlocked ? 'test-guard' : undefined,
      }),
    }

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    // Select an item so bulk-delete button is enabled
    const checkbox = root.querySelector(
      'input[data-da-role="memory-select"][data-da-item-key="summary:sum-1"]',
    ) as HTMLInputElement
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))

    const bulkBtn = root.querySelector('[data-da-action="bulk-delete-memory"]') as HTMLButtonElement
    const originalText = bulkBtn.textContent

    bulkBtn.click() // arm
    expect(bulkBtn.textContent).toBe('Confirm Delete Selected?')
    expect(bulkBtn.classList.contains('da-btn--armed')).toBe(true)

    // Block the guard so handler returns early without fullReRender
    guardBlocked = true

    bulkBtn.click() // confirm — handler hits guard and returns early
    await vi.advanceTimersByTimeAsync(100)

    // Button text must be restored, not stuck on confirm copy
    expect(bulkBtn.textContent).toBe(originalText)
    expect(bulkBtn.classList.contains('da-btn--armed')).toBe(false)
  })

  // -- delete prompt preset -------------------------------------------------

  test('first click on delete-prompt-preset only arms, second click executes', async () => {
    vi.useRealTimers()

    const { BUILTIN_PROMPT_PRESET_ID } = await import('../src/director/prompt.js')
    const { DASHBOARD_SETTINGS_KEY, createPromptPresetFromSettings } = await import('../src/ui/dashboardState.js')
    const { DEFAULT_DIRECTOR_SETTINGS } = await import('../src/contracts/types.js')

    // Create a valid custom preset via the factory
    const validPreset = createPromptPresetFromSettings(DEFAULT_DIRECTOR_SETTINGS)
    const settings = {
      ...DEFAULT_DIRECTOR_SETTINGS,
      promptPresetId: validPreset.id,
      promptPresets: { [validPreset.id]: validPreset },
    }
    await api.pluginStorage.setItem(DASHBOARD_SETTINGS_KEY, settings)
    store = createTestStore(api)

    await openDashboard(api, store)
    const root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement

    // Navigate to prompt tuning tab
    const tuningBtn = root.querySelector('[data-da-target="prompt-tuning"]') as HTMLElement
    tuningBtn.click()

    const deletePresetBtn = root.querySelector('[data-da-action="delete-prompt-preset"]') as HTMLButtonElement
    expect(deletePresetBtn).not.toBeNull()
    expect(deletePresetBtn.disabled).toBe(false)
    deletePresetBtn.click() // arm
    expect(deletePresetBtn.classList.contains('da-btn--armed')).toBe(true)

    // The preset should still be selectable (not yet deleted)
    const presetSelect = root.querySelector('[data-da-role="prompt-preset-select"]') as HTMLSelectElement
    expect(presetSelect.value).toBe(validPreset.id)

    deletePresetBtn.click() // confirm
    await new Promise((r) => { setTimeout(r, 50) })

    // After confirmation, the preset should be deleted and selection should fall back to builtin
    const updatedRoot = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const updatedSelect = updatedRoot.querySelector('[data-da-role="prompt-preset-select"]') as HTMLSelectElement
    expect(updatedSelect.value).toBe(BUILTIN_PROMPT_PRESET_ID)
  })

  // -- arming cleared on fullReRender --------------------------------------

  test('armed state is cleared when dashboard re-renders', async () => {
    let currentState = stateWithMemory()
    store = {
      storage: api.pluginStorage,
      readCanonical: async () => currentState,
      writeCanonical: async (mutator) => {
        currentState = mutator(structuredClone(currentState))
        return currentState
      },
    }

    await openDashboard(api, store)
    let root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root)

    const delBtn = root.querySelector(
      '[data-da-action="delete-summary"][data-da-item-id="sum-1"]',
    ) as HTMLElement
    delBtn.click() // arm
    expect(delBtn.classList.contains('da-btn--armed')).toBe(true)

    // Trigger a fullReRender via an add action (non-destructive mutation)
    const addInput = root.querySelector('input[data-da-role="add-summary-text"]') as HTMLInputElement
    addInput.value = 'Trigger rerender'
    const addBtn = root.querySelector('[data-da-action="add-summary"]') as HTMLElement
    addBtn.click()
    await vi.advanceTimersByTimeAsync(100)

    // After re-render, the arming should be cleared — fresh delete button
    root = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    const freshDelBtn = root.querySelector(
      '[data-da-action="delete-summary"][data-da-item-id="sum-1"]',
    ) as HTMLElement
    expect(freshDelBtn).not.toBeNull()
    expect(freshDelBtn.classList.contains('da-btn--armed')).toBe(false)
    expect(freshDelBtn.textContent).not.toBe('Confirm Delete?')
  })

  // -- arming cleared on close ---------------------------------------------

  test('armed state is cleaned up when dashboard closes', async () => {
    let currentState = stateWithMemory()
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

    const delBtn = root.querySelector(
      '[data-da-action="delete-summary"][data-da-item-id="sum-1"]',
    ) as HTMLElement
    delBtn.click() // arm

    await closeDashboard()

    // Re-open — should not carry over stale armed state
    await openDashboard(api, store)
    const root2 = document.querySelector(`.${DASHBOARD_ROOT_CLASS}`) as HTMLElement
    navigateToMemoryTab(root2)
    const freshBtn = root2.querySelector(
      '[data-da-action="delete-summary"][data-da-item-id="sum-1"]',
    ) as HTMLElement
    expect(freshBtn).not.toBeNull()
    expect(freshBtn.classList.contains('da-btn--armed')).toBe(false)
  })

  // -- Korean locale confirm text ------------------------------------------

  test('armed state shows Korean confirm text when locale is ko', async () => {
    setLocale('ko')
    let currentState = stateWithMemory()
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

    const delBtn = root.querySelector(
      '[data-da-action="delete-summary"][data-da-item-id="sum-1"]',
    ) as HTMLElement
    delBtn.click() // arm
    expect(delBtn.textContent).toBe('삭제 확인?')
  })
})
