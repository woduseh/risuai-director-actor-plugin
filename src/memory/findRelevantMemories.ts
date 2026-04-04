/**
 * Claude-style relevant memory recall.
 *
 * Builds a compact manifest from memdir document headers (without full
 * bodies), sends it to a small/cheap recall model to select the most
 * relevant document IDs, loads only the selected documents for prompt
 * projection, and falls back to deterministic keyword ranking when the
 * recall model fails, times out, or returns malformed output.
 */

import type { MemdirDocument, MemdirFreshness } from '../contracts/types.js'
import { rankDocsByKeywordOverlap } from './retrieval.js'
import {
  vectorPrefilter,
  type VectorCandidate,
} from './vectorRetrieval.js'
import {
  isTransientError,
  withRetry,
  type RetryOptions,
} from '../runtime/network.js'
import { repairParseArray } from '../runtime/jsonRepair.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RESULTS = 5
const STALE_FRESHNESS: ReadonlySet<MemdirFreshness> = new Set([
  'stale',
  'archived',
])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecallModelResponse {
  ok: boolean
  text: string
}

export interface RecallDeps {
  /** Call the recall model with a manifest and recent conversation text. */
  runRecallModel(
    manifest: string,
    recentText: string,
  ): Promise<RecallModelResponse>
  /** Log a diagnostic message. */
  log(message: string): void
}

export interface FindRelevantMemoriesInput {
  docs: MemdirDocument[]
  recentText: string
  memoryMdContent: string
  maxResults?: number
  /** Override current time for testing. */
  nowMs?: number
  /** Query embedding vector for vector prefilter (optional). */
  queryVector?: number[]
  /** Current vector version fingerprint for staleness detection. */
  vectorVersion?: string
}

export interface RecallResult {
  selectedDocs: MemdirDocument[]
  warnings: string[]
  source: 'recall' | 'fallback' | 'cache'
  /** Always populated with MEMORY.md index content. */
  memoryMdBlock: string
}

// ---------------------------------------------------------------------------
// Manifest formatting — header scan, no full document bodies
// ---------------------------------------------------------------------------

/**
 * Format a lightweight manifest from document headers.
 * Includes id, type, title, tags, and freshness — never full descriptions.
 */
export function formatManifest(docs: MemdirDocument[]): string {
  if (docs.length === 0) return '(no memory documents)'

  return docs
    .map((doc) => {
      const tags = doc.tags.length > 0 ? doc.tags.join(', ') : 'none'
      const fresh = doc.freshness !== 'current' ? ` [${doc.freshness}]` : ''
      return `ID: ${doc.id} | Type: ${doc.type} | Title: ${doc.title}${fresh} | Tags: ${tags}`
    })
    .join('\n')
}

// ---------------------------------------------------------------------------
// RecallCache — respects recallCooldownMs
// ---------------------------------------------------------------------------

/**
 * Simple cooldown cache that reuses recent recall results to avoid
 * redundant model calls on rapid successive turns.
 */
export class RecallCache {
  private readonly cooldownMs: number
  private entry: { result: RecallResult; timestamp: number } | null = null

  constructor(cooldownMs: number) {
    this.cooldownMs = cooldownMs
  }

  get(nowMs?: number): RecallResult | null {
    if (!this.entry) return null
    const now = nowMs ?? Date.now()
    if (now - this.entry.timestamp > this.cooldownMs) return null
    return this.entry.result
  }

  set(result: RecallResult, nowMs?: number): void {
    this.entry = { result, timestamp: nowMs ?? Date.now() }
  }
}

// ---------------------------------------------------------------------------
// Freshness warnings
// ---------------------------------------------------------------------------

function buildFreshnessWarnings(docs: MemdirDocument[]): string[] {
  const warnings: string[] = []
  for (const doc of docs) {
    if (STALE_FRESHNESS.has(doc.freshness)) {
      warnings.push(
        `Memory "${doc.title}" may be outdated (marked as ${doc.freshness})`,
      )
    }
  }
  return warnings
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseRecallResponse(text: string): string[] | null {
  const parsed = repairParseArray(text)
  if (!parsed) return null

  const ids = parsed.filter(
    (item): item is string => typeof item === 'string',
  )
  // Reject if every element was non-string (model returned wrong types)
  if (ids.length === 0 && parsed.length > 0) return null

  return ids
}

// ---------------------------------------------------------------------------
// Deterministic fallback
// ---------------------------------------------------------------------------

function buildFallbackResult(
  docs: MemdirDocument[],
  recentText: string,
  memoryMdContent: string,
  maxResults: number,
): RecallResult {
  const selected = rankDocsByKeywordOverlap(docs, recentText, maxResults)
  const warnings = buildFreshnessWarnings(selected)
  return {
    selectedDocs: selected,
    warnings,
    source: 'fallback',
    memoryMdBlock: memoryMdContent,
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Find relevant memory documents using a recall model call, falling
 * back to deterministic keyword ranking on failure.
 */
export async function findRelevantMemories(
  deps: RecallDeps,
  input: FindRelevantMemoriesInput,
  cache?: RecallCache,
  retryOptions?: RetryOptions,
): Promise<RecallResult> {
  const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS

  // Check cache (respects recallCooldownMs)
  if (cache) {
    const cached = cache.get(input.nowMs)
    if (cached) {
      return { ...cached, source: 'cache' }
    }
  }

  // Empty doc set — return immediately with MEMORY.md
  if (input.docs.length === 0) {
    const result: RecallResult = {
      selectedDocs: [],
      warnings: [],
      source: 'recall',
      memoryMdBlock: input.memoryMdContent,
    }
    if (cache) cache.set(result, input.nowMs)
    return result
  }

  // ── Vector prefilter ──────────────────────────────────────────────
  // When a query vector and vector version are provided, narrow the
  // candidate set to docs with current embeddings that score well.
  // Docs without embeddings or with stale versions pass through
  // unfiltered to preserve keyword fallback access.
  let manifestDocs = input.docs
  if (input.queryVector && input.vectorVersion) {
    const candidates: VectorCandidate[] = []
    const unembedded: MemdirDocument[] = []

    for (const doc of input.docs) {
      if (
        doc.embedding &&
        doc.embedding.version === input.vectorVersion &&
        doc.embedding.vector.length > 0
      ) {
        candidates.push({ id: doc.id, vector: doc.embedding.vector })
      } else {
        unembedded.push(doc)
      }
    }

    if (candidates.length > 0) {
      const prefiltered = vectorPrefilter(candidates, input.queryVector, {
        maxResults: maxResults * 2,
        minSimilarity: 0.1,
      })
      const prefilteredIds = new Set(prefiltered.map((r) => r.id))
      const prefilteredDocs = input.docs.filter((d) => prefilteredIds.has(d.id))
      // Merge prefiltered + unembedded (don't block docs missing vectors)
      const mergedIds = new Set(prefilteredDocs.map((d) => d.id))
      for (const ue of unembedded) mergedIds.add(ue.id)
      manifestDocs = input.docs.filter((d) => mergedIds.has(d.id))
    }
  }

  // Format manifest (headers only — no full bodies)
  const manifest = formatManifest(manifestDocs)

  // Try recall model (with retry for transient failures)
  try {
    const recallRetryOpts: RetryOptions = {
      ...retryOptions,
      log: (msg) => deps.log(`[recall] ${msg}`),
    }
    const response = await withRetry(async () => {
      const resp = await deps.runRecallModel(manifest, input.recentText)
      // Convert transient !ok responses to thrown errors so withRetry
      // can retry them.  Non-transient failures pass through as-is.
      if (!resp.ok && isTransientError(resp.text)) {
        throw new Error(resp.text)
      }
      return resp
    }, recallRetryOpts)

    if (!response.ok) {
      deps.log(`Recall model failed: ${response.text}`)
      const fallback = buildFallbackResult(
        input.docs,
        input.recentText,
        input.memoryMdContent,
        maxResults,
      )
      if (cache) cache.set(fallback, input.nowMs)
      return fallback
    }

    const selectedIds = parseRecallResponse(response.text)
    if (!selectedIds) {
      deps.log(`Recall model returned malformed response: ${response.text}`)
      const fallback = buildFallbackResult(
        input.docs,
        input.recentText,
        input.memoryMdContent,
        maxResults,
      )
      if (cache) cache.set(fallback, input.nowMs)
      return fallback
    }

    // Filter to selected IDs, bounded by maxResults
    const idSet = new Set(selectedIds.slice(0, maxResults))
    const selectedDocs = input.docs.filter((d) => idSet.has(d.id))
    const warnings = buildFreshnessWarnings(selectedDocs)

    const result: RecallResult = {
      selectedDocs,
      warnings,
      source: 'recall',
      memoryMdBlock: input.memoryMdContent,
    }

    if (cache) cache.set(result, input.nowMs)
    return result
  } catch (err) {
    deps.log(`Recall model threw: ${err}`)
    const fallback = buildFallbackResult(
      input.docs,
      input.recentText,
      input.memoryMdContent,
      maxResults,
    )
    if (cache) cache.set(fallback, input.nowMs)
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Block formatter — builds the text injected into Director prompts
// ---------------------------------------------------------------------------

/**
 * Format a recall result into a prompt block. Always includes the
 * MEMORY.md index, and optionally includes recalled doc details
 * plus freshness warnings.
 */
export function formatRecalledDocsBlock(result: RecallResult): string {
  const lines: string[] = [result.memoryMdBlock]

  if (result.selectedDocs.length > 0) {
    lines.push('')
    lines.push('## Recalled Memory Documents')
    for (const doc of result.selectedDocs) {
      lines.push(`- **${doc.title}** (${doc.type}): ${doc.description}`)
    }
  }

  if (result.warnings.length > 0) {
    lines.push('')
    for (const warning of result.warnings) {
      lines.push(`⚠️ ${warning}`)
    }
  }

  return lines.join('\n')
}
