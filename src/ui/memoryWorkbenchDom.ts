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
import { MEMDIR_DOCUMENT_TYPES, MEMDIR_FRESHNESS_VALUES, MEMDIR_SOURCE_VALUES } from '../contracts/types.js'
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

const FRESHNESS_VALUES: readonly MemdirFreshness[] = MEMDIR_FRESHNESS_VALUES
const SOURCE_VALUES: readonly MemdirSource[] = MEMDIR_SOURCE_VALUES

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

  return `<div class="cd-inline cd-workbench-filters">
    <label class="cd-label"><span class="cd-label-text">${t('workbench.filterType')}</span><select class="cd-select cd-select--sm" data-cd-role="workbench-filter-type">${typeOptions}</select></label>
    <label class="cd-label"><span class="cd-label-text">${t('workbench.filterFreshness')}</span><select class="cd-select cd-select--sm" data-cd-role="workbench-filter-freshness">${freshnessOptions}</select></label>
    <label class="cd-label"><span class="cd-label-text">${t('workbench.filterSource')}</span><select class="cd-select cd-select--sm" data-cd-role="workbench-filter-source">${sourceOptions}</select></label>
  </div>`
}

// ---------------------------------------------------------------------------
// Document list
// ---------------------------------------------------------------------------

function buildDocumentItem(doc: WorkbenchDocEntry): string {
  const embeddingBadge = doc.hasEmbedding
    ? `<span class="cd-badge cd-badge--sm" data-kind="success">${t('workbench.embedded')}</span>`
    : `<span class="cd-badge cd-badge--sm" data-kind="neutral">${t('workbench.notEmbedded')}</span>`

  const freshnessBadge = `<span class="cd-badge cd-badge--sm" data-kind="${
    doc.freshness === 'current' ? 'success' : doc.freshness === 'stale' ? 'stale' : 'neutral'
  }">${escapeXml(doc.freshness)}</span>`

  return `<li class="cd-memory-item" data-cd-role="workbench-doc-item" data-cd-doc-id="${escapeXml(doc.id)}">
    <span class="cd-workbench-doc-title">${escapeXml(doc.title)}</span>
    <span class="cd-workbench-doc-meta">${escapeXml(doc.type)} · ${escapeXml(doc.source)} · ${escapeXml(formatTimestamp(doc.updatedAt))}</span>
    ${freshnessBadge}${embeddingBadge}
  </li>`
}

function buildDocumentList(docs: WorkbenchDocEntry[], hasUnfilteredDocs: boolean): string {
  if (docs.length === 0) {
    if (hasUnfilteredDocs) {
      return `<p class="cd-empty" data-cd-role="workbench-no-match">${t('workbench.noMatchHint')}</p>`
    }
    return `<p class="cd-empty" data-cd-role="workbench-empty">${t('workbench.emptyHint')}</p>`
  }
  const items = docs.map(buildDocumentItem).join('')
  return `<ul class="cd-memory-list" data-cd-role="workbench-doc-list">${items}</ul>`
}

// ---------------------------------------------------------------------------
// MEMORY.md preview
// ---------------------------------------------------------------------------

function buildMemoryMdPreview(content: string): string {
  return `<section class="cd-card" data-cd-role="workbench-memory-md">
    <div class="cd-card-header"><div><h4 class="cd-card-title">${t('workbench.memoryMdTitle')}</h4></div></div>
    <pre class="cd-workbench-preview">${escapeXml(content)}</pre>
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
        `<li class="cd-metric-item" data-cd-role="workbench-notebook-entry"><span>${escapeXml(NOTEBOOK_SECTION_LABELS[key])}</span><strong>${escapeXml(snap[key])}</strong></li>`,
    )
    .join('')

  if (entries.length === 0) {
    return `<section class="cd-card" data-cd-role="workbench-notebook">
      <div class="cd-card-header"><div><h4 class="cd-card-title">${t('workbench.notebookTitle')}</h4></div></div>
      <p class="cd-empty">${t('workbench.notebookEmpty')}</p>
    </section>`
  }

  return `<section class="cd-card" data-cd-role="workbench-notebook">
    <div class="cd-card-header"><div><h4 class="cd-card-title">${t('workbench.notebookTitle')}</h4></div></div>
    <ul class="cd-metric-list">${entries}</ul>
  </section>`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the read-only Memory Workbench HTML for the memory document inspector.
 * This is a pure function — no side effects, no DOM mutation.
 */
export function buildMemoryWorkbench(input: MemoryWorkbenchInput): string {
  // Error state (inline, does not suppress the card wrapper)
  const errorHtml = input.error
    ? `<p class="cd-empty cd-workbench-error" data-cd-role="workbench-error">${escapeXml(input.error)}</p>`
    : ''

  // Loading state
  if (input.loading) {
    return `<section class="cd-card" data-cd-role="workbench-section">
      <div class="cd-card-header"><div><h4 class="cd-card-title">${t('workbench.title')}</h4><p class="cd-card-copy">${t('workbench.copy')}</p></div></div>
      <p class="cd-empty" data-cd-role="workbench-loading">${t('workbench.loading')}</p>
    </section>`
  }

  // Apply filters
  const filtered = applyFilters(input.documents, input.filters)

  // Document list or empty state
  const listHtml = input.documents.length > 0
    ? buildDocumentList(filtered, true)
    : buildDocumentList([], false)

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

  return `<section class="cd-card" data-cd-role="workbench-section">
    <div class="cd-card-header"><div><h4 class="cd-card-title">${t('workbench.title')}</h4><p class="cd-card-copy">${t('workbench.copy')}</p></div></div>
    ${errorHtml}${filterHtml}${listHtml}
  </section>
  ${memoryMdHtml}${notebookHtml}`
}
