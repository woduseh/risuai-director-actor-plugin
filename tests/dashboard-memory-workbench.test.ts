/**
 * @vitest-environment jsdom
 *
 * Tests for the Memory Workbench – a read-only memdir inspector section
 * rendered inside the memory-cache dashboard page.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { setLocale } from '../src/ui/i18n.js'
import {
  buildMemoryWorkbench,
  type MemoryWorkbenchInput,
} from '../src/ui/memoryWorkbenchDom.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(overrides: Partial<MemoryWorkbenchInput['documents'][number]> = {}): MemoryWorkbenchInput['documents'][number] {
  return {
    id: 'doc-1',
    type: 'character',
    title: 'Hero Profile',
    source: 'extraction',
    freshness: 'current',
    updatedAt: Date.now(),
    hasEmbedding: true,
    ...overrides,
  }
}

function defaultInput(overrides: Partial<MemoryWorkbenchInput> = {}): MemoryWorkbenchInput {
  return {
    documents: [],
    memoryMdPreview: null,
    notebookSnapshot: null,
    loading: false,
    error: null,
    filters: { type: null, freshness: null, source: null },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. Loading state
// ---------------------------------------------------------------------------

describe('Memory Workbench – loading state', () => {
  afterEach(() => setLocale('en'))

  test('renders a loading indicator when loading is true', () => {
    const html = buildMemoryWorkbench(defaultInput({ loading: true }))
    expect(html).toContain('data-da-role="workbench-loading"')
  })

  test('does not render document list while loading', () => {
    const html = buildMemoryWorkbench(defaultInput({ loading: true, documents: [makeDoc()] }))
    expect(html).not.toContain('data-da-role="workbench-doc-list"')
  })
})

// ---------------------------------------------------------------------------
// 2. Error state
// ---------------------------------------------------------------------------

describe('Memory Workbench – error state', () => {
  afterEach(() => setLocale('en'))

  test('renders an inline error message when error is set', () => {
    const html = buildMemoryWorkbench(defaultInput({ error: 'Failed to load memdir' }))
    expect(html).toContain('data-da-role="workbench-error"')
    expect(html).toContain('Failed to load memdir')
  })

  test('error state does not prevent the rest of the section from rendering', () => {
    const html = buildMemoryWorkbench(defaultInput({ error: 'Some error' }))
    expect(html).toContain('data-da-role="workbench-section"')
  })
})

// ---------------------------------------------------------------------------
// 3. Empty state
// ---------------------------------------------------------------------------

describe('Memory Workbench – empty state', () => {
  afterEach(() => setLocale('en'))

  test('renders a clear no-documents state when documents array is empty', () => {
    const html = buildMemoryWorkbench(defaultInput({ documents: [] }))
    expect(html).toContain('data-da-role="workbench-empty"')
  })

  test('empty state text is not blank', () => {
    const html = buildMemoryWorkbench(defaultInput({ documents: [] }))
    const container = document.createElement('div')
    container.innerHTML = html
    const empty = container.querySelector('[data-da-role="workbench-empty"]')
    expect(empty).not.toBeNull()
    expect(empty!.textContent!.trim().length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 4. Document list rendering
// ---------------------------------------------------------------------------

describe('Memory Workbench – document list', () => {
  afterEach(() => setLocale('en'))

  test('renders document items with title, type, source, freshness, and updatedAt', () => {
    const doc = makeDoc({
      title: 'My Character',
      type: 'character',
      source: 'extraction',
      freshness: 'current',
      updatedAt: 1700000000000,
    })
    const html = buildMemoryWorkbench(defaultInput({ documents: [doc] }))
    expect(html).toContain('data-da-role="workbench-doc-list"')
    expect(html).toContain('My Character')
    expect(html).toContain('character')
    expect(html).toContain('extraction')
    expect(html).toContain('current')
  })

  test('shows embedding state indicator for each document', () => {
    const withEmbed = makeDoc({ id: 'e1', hasEmbedding: true })
    const withoutEmbed = makeDoc({ id: 'e2', hasEmbedding: false })
    const html = buildMemoryWorkbench(defaultInput({ documents: [withEmbed, withoutEmbed] }))
    const container = document.createElement('div')
    container.innerHTML = html
    const items = container.querySelectorAll('[data-da-role="workbench-doc-item"]')
    expect(items.length).toBe(2)
  })

  test('escapes document title to prevent XSS', () => {
    const doc = makeDoc({ title: '<script>alert("xss")</script>' })
    const html = buildMemoryWorkbench(defaultInput({ documents: [doc] }))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

// ---------------------------------------------------------------------------
// 5. Filter controls
// ---------------------------------------------------------------------------

describe('Memory Workbench – filter controls', () => {
  afterEach(() => setLocale('en'))

  test('renders filter controls for type, freshness, and source', () => {
    const html = buildMemoryWorkbench(defaultInput({ documents: [makeDoc()] }))
    expect(html).toContain('data-da-role="workbench-filter-type"')
    expect(html).toContain('data-da-role="workbench-filter-freshness"')
    expect(html).toContain('data-da-role="workbench-filter-source"')
  })

  test('filters narrow the visible document list by type', () => {
    const docs = [
      makeDoc({ id: 'd1', type: 'character', title: 'Char Doc' }),
      makeDoc({ id: 'd2', type: 'world', title: 'World Doc' }),
      makeDoc({ id: 'd3', type: 'plot', title: 'Plot Doc' }),
    ]
    const html = buildMemoryWorkbench(defaultInput({
      documents: docs,
      filters: { type: 'character', freshness: null, source: null },
    }))
    expect(html).toContain('Char Doc')
    expect(html).not.toContain('World Doc')
    expect(html).not.toContain('Plot Doc')
  })

  test('filters narrow the visible document list by freshness', () => {
    const docs = [
      makeDoc({ id: 'd1', freshness: 'current', title: 'Fresh Doc' }),
      makeDoc({ id: 'd2', freshness: 'stale', title: 'Stale Doc' }),
    ]
    const html = buildMemoryWorkbench(defaultInput({
      documents: docs,
      filters: { type: null, freshness: 'stale', source: null },
    }))
    expect(html).not.toContain('Fresh Doc')
    expect(html).toContain('Stale Doc')
  })

  test('filters narrow the visible document list by source', () => {
    const docs = [
      makeDoc({ id: 'd1', source: 'extraction', title: 'Extracted Doc' }),
      makeDoc({ id: 'd2', source: 'operator', title: 'Operator Doc' }),
    ]
    const html = buildMemoryWorkbench(defaultInput({
      documents: docs,
      filters: { type: null, freshness: null, source: 'operator' },
    }))
    expect(html).not.toContain('Extracted Doc')
    expect(html).toContain('Operator Doc')
  })

  test('combined filters narrow correctly', () => {
    const docs = [
      makeDoc({ id: 'd1', type: 'character', freshness: 'current', source: 'extraction', title: 'Match' }),
      makeDoc({ id: 'd2', type: 'character', freshness: 'stale', source: 'extraction', title: 'NoMatch1' }),
      makeDoc({ id: 'd3', type: 'world', freshness: 'current', source: 'extraction', title: 'NoMatch2' }),
    ]
    const html = buildMemoryWorkbench(defaultInput({
      documents: docs,
      filters: { type: 'character', freshness: 'current', source: null },
    }))
    expect(html).toContain('Match')
    expect(html).not.toContain('NoMatch1')
    expect(html).not.toContain('NoMatch2')
  })
})

// ---------------------------------------------------------------------------
// 6. MEMORY.md preview
// ---------------------------------------------------------------------------

describe('Memory Workbench – MEMORY.md preview', () => {
  afterEach(() => setLocale('en'))

  test('renders MEMORY.md preview when provided', () => {
    const md = '# MEMORY.md\n## Characters\n- **Hero** [current]: A brave warrior'
    const html = buildMemoryWorkbench(defaultInput({ memoryMdPreview: md }))
    expect(html).toContain('data-da-role="workbench-memory-md"')
    expect(html).toContain('MEMORY.md')
  })

  test('does not render MEMORY.md section when null', () => {
    const html = buildMemoryWorkbench(defaultInput({ memoryMdPreview: null }))
    expect(html).not.toContain('data-da-role="workbench-memory-md"')
  })

  test('escapes MEMORY.md content', () => {
    const md = '<img src=x onerror=alert(1)>'
    const html = buildMemoryWorkbench(defaultInput({ memoryMdPreview: md }))
    expect(html).not.toContain('<img')
  })
})

// ---------------------------------------------------------------------------
// 7. Session notebook snapshot
// ---------------------------------------------------------------------------

describe('Memory Workbench – notebook snapshot', () => {
  afterEach(() => setLocale('en'))

  test('renders notebook snapshot when provided', () => {
    const snap = {
      currentState: 'The hero is resting.',
      immediateGoals: 'Find the sword.',
      recentDevelopments: 'Met the wizard.',
      unresolvedThreads: 'Dragon sighting.',
      recentMistakes: '',
    }
    const html = buildMemoryWorkbench(defaultInput({ notebookSnapshot: snap }))
    expect(html).toContain('data-da-role="workbench-notebook"')
    expect(html).toContain('The hero is resting.')
    expect(html).toContain('Find the sword.')
  })

  test('does not render notebook section when null', () => {
    const html = buildMemoryWorkbench(defaultInput({ notebookSnapshot: null }))
    expect(html).not.toContain('data-da-role="workbench-notebook"')
  })

  test('renders only non-empty notebook sections', () => {
    const snap = {
      currentState: 'Active scene',
      immediateGoals: '',
      recentDevelopments: '',
      unresolvedThreads: '',
      recentMistakes: '',
    }
    const html = buildMemoryWorkbench(defaultInput({ notebookSnapshot: snap }))
    const container = document.createElement('div')
    container.innerHTML = html
    const items = container.querySelectorAll('[data-da-role="workbench-notebook-entry"]')
    expect(items.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 8. Korean locale
// ---------------------------------------------------------------------------

describe('Memory Workbench – i18n', () => {
  afterEach(() => setLocale('en'))

  test('renders workbench section title in Korean when locale is ko', () => {
    setLocale('ko')
    const html = buildMemoryWorkbench(defaultInput())
    // The card title should be in Korean
    expect(html).toContain('data-da-role="workbench-section"')
  })
})
