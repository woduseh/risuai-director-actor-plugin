/**
 * memoryWorkbenchDom.ts — Read-only Memdir Inspector markup builder.
 *
 * Renders a workbench section inside the memory-cache page that displays:
 * - Memdir document list with metadata (title, type, source, freshness, updatedAt, embedding state)
 * - Filter controls for type, freshness, and source
 * - MEMORY.md preview
 * - Session notebook snapshot
 * - Loading, empty, and inline error states
 *
 * This module is intentionally read-only: no create/edit/delete actions.
 */
import type { MemdirDocumentType, MemdirFreshness, MemdirSource } from '../contracts/types.js'
import { MEMDIR_DOCUMENT_TYPES } from '../contracts/types.js'
import { escapeXml } from '../utils/xml.js'
import { t } from './i18n.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pre-projected document summary for the workbench (no raw embedding vectors). */
export interface WorkbenchDocEntry {
  id: string
  type: MemdirDocumentType
  title: string
  source: MemdirSource
  freshness: MemdirFreshness
  updatedAt: number
  hasEmbedding: boolean
}

export interface WorkbenchFilters {
  type: MemdirDocumentType | null
  freshness: MemdirFreshness | null
  source: MemdirSource | null
}

/** Notebook snapshot sections (mirrors NotebookSnapshot shape). */
export interface WorkbenchNotebookSnapshot {
  currentState: string
  immediateGoals: string
  recentDevelopments: string
  unresolvedThreads: string
  recentMistakes: string
}

export interface MemoryWorkbenchInput {
  documents: WorkbenchDocEntry[]
  memoryMdPreview: string | null
  notebookSnapshot: WorkbenchNotebookSnapshot | null
  loading: boolean
  error: string | null
  filters: WorkbenchFilters
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FRESHNESS_VALUES: MemdirFreshness[] = ['current', 'stale', 'archived']
const SOURCE_VALUES: MemdirSource[] = ['extraction', 'operator', 'migration', 'manual']

const NOTEBOOK_SECTION_LABELS: Record<keyof WorkbenchNotebookSnapshot, string> = {
  currentState: 'Current State',
  immediateGoals: 'Immediate Goals',
  recentDevelopments: 'Recent Developments',
  unresolvedThreads: 'Unresolved Threads',
  recentMistakes: 'Recent Mistakes',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: number): string {
  if (ts === 0) return '—'
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return String(ts)
  }
}

function applyFilters(
  docs: WorkbenchDocEntry[],
  filters: WorkbenchFilters,
): WorkbenchDocEntry[] {
  return docs.filter((d) => {
    if (filters.type != null && d.type !== filters.type) return false
    if (filters.freshness != null && d.freshness !== filters.freshness) return false
    if (filters.source != null && d.source !== filters.source) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// Filter controls
// ---------------------------------------------------------------------------

function buildFilterControls(filters: WorkbenchFilters): string {
  const typeOptions = [
    `<option value=""${filters.type == null ? ' selected' : ''}>${t('workbench.filterAll')}</option>`,
    ...MEMDIR_DOCUMENT_TYPES.map(
      (tp) =>
        `<option value="${tp}"${filters.type === tp ? ' selected' : ''}>${escapeXml(tp)}</option>`,
    ),
  ].join('')

  const freshnessOptions = [
    `<option value=""${filters.freshness == null ? ' selected' : ''}>${t('workbench.filterAll')}</option>`,
    ...FRESHNESS_VALUES.map(
      (f) =>
        `<option value="${f}"${filters.freshness === f ? ' selected' : ''}>${escapeXml(f)}</option>`,
    ),
  ].join('')

  const sourceOptions = [
    `<option value=""${filters.source == null ? ' selected' : ''}>${t('workbench.filterAll')}</option>`,
    ...SOURCE_VALUES.map(
      (s) =>
        `<option value="${s}"${filters.source === s ? ' selected' : ''}>${escapeXml(s)}</option>`,
    ),
  ].join('')

  return `<div class="da-inline da-workbench-filters">
    <label class="da-label"><span class="da-label-text">${t('workbench.filterType')}</span><select class="da-select da-select--sm" data-da-role="workbench-filter-type">${typeOptions}</select></label>
    <label class="da-label"><span class="da-label-text">${t('workbench.filterFreshness')}</span><select class="da-select da-select--sm" data-da-role="workbench-filter-freshness">${freshnessOptions}</select></label>
    <label class="da-label"><span class="da-label-text">${t('workbench.filterSource')}</span><select class="da-select da-select--sm" data-da-role="workbench-filter-source">${sourceOptions}</select></label>
  </div>`
}

// ---------------------------------------------------------------------------
// Document list
// ---------------------------------------------------------------------------

function buildDocumentItem(doc: WorkbenchDocEntry): string {
  const embeddingBadge = doc.hasEmbedding
    ? `<span class="da-badge da-badge--sm" data-kind="success">${t('workbench.embedded')}</span>`
    : `<span class="da-badge da-badge--sm" data-kind="neutral">${t('workbench.notEmbedded')}</span>`

  const freshnessBadge = `<span class="da-badge da-badge--sm" data-kind="${
    doc.freshness === 'current' ? 'success' : doc.freshness === 'stale' ? 'stale' : 'neutral'
  }">${escapeXml(doc.freshness)}</span>`

  return `<li class="da-memory-item" data-da-role="workbench-doc-item" data-da-doc-id="${escapeXml(doc.id)}">
    <span class="da-workbench-doc-title">${escapeXml(doc.title)}</span>
    <span class="da-workbench-doc-meta">${escapeXml(doc.type)} · ${escapeXml(doc.source)} · ${formatTimestamp(doc.updatedAt)}</span>
    ${freshnessBadge}${embeddingBadge}
  </li>`
}

function buildDocumentList(docs: WorkbenchDocEntry[]): string {
  if (docs.length === 0) {
    return `<p class="da-empty" data-da-role="workbench-empty">${t('workbench.emptyHint')}</p>`
  }
  const items = docs.map(buildDocumentItem).join('')
  return `<ul class="da-memory-list" data-da-role="workbench-doc-list">${items}</ul>`
}

// ---------------------------------------------------------------------------
// MEMORY.md preview
// ---------------------------------------------------------------------------

function buildMemoryMdPreview(content: string): string {
  return `<section class="da-card" data-da-role="workbench-memory-md">
    <div class="da-card-header"><div><h4 class="da-card-title">${t('workbench.memoryMdTitle')}</h4></div></div>
    <pre class="da-workbench-preview">${escapeXml(content)}</pre>
  </section>`
}

// ---------------------------------------------------------------------------
// Notebook snapshot
// ---------------------------------------------------------------------------

function buildNotebookSnapshot(snap: WorkbenchNotebookSnapshot): string {
  const entries = (Object.keys(NOTEBOOK_SECTION_LABELS) as Array<keyof WorkbenchNotebookSnapshot>)
    .filter((key) => snap[key].length > 0)
    .map(
      (key) =>
        `<li class="da-metric-item" data-da-role="workbench-notebook-entry"><span>${escapeXml(NOTEBOOK_SECTION_LABELS[key])}</span><strong>${escapeXml(snap[key])}</strong></li>`,
    )
    .join('')

  if (entries.length === 0) {
    return `<section class="da-card" data-da-role="workbench-notebook">
      <div class="da-card-header"><div><h4 class="da-card-title">${t('workbench.notebookTitle')}</h4></div></div>
      <p class="da-empty">${t('workbench.notebookEmpty')}</p>
    </section>`
  }

  return `<section class="da-card" data-da-role="workbench-notebook">
    <div class="da-card-header"><div><h4 class="da-card-title">${t('workbench.notebookTitle')}</h4></div></div>
    <ul class="da-metric-list">${entries}</ul>
  </section>`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the read-only Memory Workbench HTML for the memdir inspector.
 * This is a pure function — no side effects, no DOM mutation.
 */
export function buildMemoryWorkbench(input: MemoryWorkbenchInput): string {
  // Error state (inline, does not suppress the card wrapper)
  const errorHtml = input.error
    ? `<p class="da-empty da-workbench-error" data-da-role="workbench-error">${escapeXml(input.error)}</p>`
    : ''

  // Loading state
  if (input.loading) {
    return `<section class="da-card" data-da-role="workbench-section">
      <div class="da-card-header"><div><h4 class="da-card-title">${t('workbench.title')}</h4><p class="da-card-copy">${t('workbench.copy')}</p></div></div>
      <p class="da-empty" data-da-role="workbench-loading">${t('workbench.loading')}</p>
    </section>`
  }

  // Apply filters
  const filtered = applyFilters(input.documents, input.filters)

  // Document list or empty state
  const listHtml = input.documents.length > 0
    ? buildDocumentList(filtered)
    : buildDocumentList([]) // show empty hint

  // Filter controls (only when there are docs to filter)
  const filterHtml = input.documents.length > 0
    ? buildFilterControls(input.filters)
    : ''

  // MEMORY.md preview
  const memoryMdHtml = input.memoryMdPreview != null
    ? buildMemoryMdPreview(input.memoryMdPreview)
    : ''

  // Notebook snapshot
  const notebookHtml = input.notebookSnapshot != null
    ? buildNotebookSnapshot(input.notebookSnapshot)
    : ''

  return `<section class="da-card" data-da-role="workbench-section">
    <div class="da-card-header"><div><h4 class="da-card-title">${t('workbench.title')}</h4><p class="da-card-copy">${t('workbench.copy')}</p></div></div>
    ${errorHtml}${filterHtml}${listHtml}
  </section>
  ${memoryMdHtml}${notebookHtml}`
}
