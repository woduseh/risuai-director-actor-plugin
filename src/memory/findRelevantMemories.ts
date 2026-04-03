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
  try {
    const match = text.match(/\[[\s\S]*?\]/)
    if (!match) return null

    const parsed: unknown = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return null

    const ids = parsed.filter(
      (item): item is string => typeof item === 'string',
    )
    if (ids.length === 0 && parsed.length > 0) return null

    return ids
  } catch {
    return null
  }
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

  // Format manifest (headers only — no full bodies)
  const manifest = formatManifest(input.docs)

  // Try recall model
  try {
    const response = await deps.runRecallModel(manifest, input.recentText)

    if (!response.ok) {
      deps.log(`Recall model failed: ${response.text}`)
      return buildFallbackResult(
        input.docs,
        input.recentText,
        input.memoryMdContent,
        maxResults,
      )
    }

    const selectedIds = parseRecallResponse(response.text)
    if (!selectedIds) {
      deps.log(`Recall model returned malformed response: ${response.text}`)
      return buildFallbackResult(
        input.docs,
        input.recentText,
        input.memoryMdContent,
        maxResults,
      )
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
    return buildFallbackResult(
      input.docs,
      input.recentText,
      input.memoryMdContent,
      maxResults,
    )
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
