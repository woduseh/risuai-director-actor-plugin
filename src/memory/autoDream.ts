import type { MemdirDocument, MemdirSource } from '../contracts/types.js'
import type { MemdirStore } from './memdirStore.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum consolidation-eligible docs before the model is invoked. */
const MIN_DOCS_FOR_CONSOLIDATION = 2

/** Sources that the dream worker is allowed to merge/prune. */
const CONSOLIDATION_ELIGIBLE_SOURCES: ReadonlySet<MemdirSource> = new Set([
  'extraction',
])

/** Sources that are user-locked and must never be auto-pruned. */
const USER_LOCKED_SOURCES: ReadonlySet<MemdirSource> = new Set([
  'operator',
  'manual',
])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DreamCadenceGate {
  enabled: boolean
  lastDreamTs: number
  dreamMinHoursElapsed: number
  turnsSinceLastDream: number
  dreamMinTurnsElapsed: number
  sessionsSinceLastDream: number
  dreamMinSessionsElapsed: number
  /** Milliseconds to wait after the last user interaction before running. */
  userInteractionGuardMs: number
  /** Epoch ms of last known user interaction (turn send, dashboard open…). */
  lastUserInteractionTs: number
}

export interface DreamResult {
  merged: number
  pruned: number
  updated: number
  skipped: boolean
}

export interface AutoDreamDeps {
  memdirStore: MemdirStore
  log(message: string): void
  /**
   * Call the LLM with a consolidation prompt and return the raw JSON response.
   * The prompt contains document manifests; the model returns merge/prune ops.
   */
  runConsolidationModel(prompt: string): Promise<string>
}

// ---------------------------------------------------------------------------
// Model response schema (JSON from model)
// ---------------------------------------------------------------------------

interface ConsolidationMerge {
  sourceIds: string[]
  mergedDoc: {
    type: string
    title: string
    description: string
    tags: string[]
  }
}

interface ConsolidationUpdate {
  id: string
  description?: string
  freshness?: string
  tags?: string[]
}

interface ConsolidationResponse {
  merges: ConsolidationMerge[]
  prunes: string[]
  updates: ConsolidationUpdate[]
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export interface AutoDreamWorker {
  /** Cheap boolean check for cadence gating. */
  shouldRun(gate: DreamCadenceGate): boolean
  /** Execute the staged consolidation loop. */
  run(): Promise<DreamResult>
}

/**
 * Create an autoDream consolidation worker.
 *
 * The worker follows a bounded staged loop:
 *   orient → gather → consolidate → prune
 *
 * It only processes extraction-created (or dream-managed) docs and
 * never prunes user-locked memories (operator / manual).
 */
export function createAutoDreamWorker(deps: AutoDreamDeps): AutoDreamWorker {
  // ── Cadence gate ────────────────────────────────────────────────────

  function shouldRun(gate: DreamCadenceGate): boolean {
    if (!gate.enabled) return false

    // Time gate
    if (gate.dreamMinHoursElapsed > 0) {
      const elapsedMs = Date.now() - gate.lastDreamTs
      const requiredMs = gate.dreamMinHoursElapsed * 3_600_000
      if (elapsedMs < requiredMs) return false
    }

    // Turn gate
    if (gate.turnsSinceLastDream < gate.dreamMinTurnsElapsed) return false

    // Session gate
    if (gate.sessionsSinceLastDream < gate.dreamMinSessionsElapsed) return false

    // User interaction guard — avoid running while user is actively chatting
    if (gate.userInteractionGuardMs > 0) {
      const sinceInteraction = Date.now() - gate.lastUserInteractionTs
      if (sinceInteraction < gate.userInteractionGuardMs) return false
    }

    return true
  }

  // ── Staged loop ─────────────────────────────────────────────────────

  async function run(): Promise<DreamResult> {
    const result: DreamResult = { merged: 0, pruned: 0, updated: 0, skipped: false }

    // ── Stage 1: Orient ─────────────────────────────────────────────
    deps.log('[dream] orient: loading manifest')
    const allDocs = await deps.memdirStore.listDocuments()

    // Filter to consolidation-eligible docs
    const eligibleDocs = allDocs.filter((d) =>
      CONSOLIDATION_ELIGIBLE_SOURCES.has(d.source),
    )

    if (eligibleDocs.length < MIN_DOCS_FOR_CONSOLIDATION) {
      deps.log('[dream] orient: not enough eligible docs, skipping')
      result.skipped = true
      return result
    }

    // Build a lookup map for all docs (needed for user-lock checks)
    const docMap = new Map<string, MemdirDocument>()
    for (const doc of allDocs) {
      docMap.set(doc.id, doc)
    }

    // ── Stage 2: Gather ─────────────────────────────────────────────
    deps.log('[dream] gather: building consolidation prompt')
    const prompt = buildConsolidationPrompt(eligibleDocs)

    // ── Stage 3: Consolidate ────────────────────────────────────────
    deps.log('[dream] consolidate: calling model')
    const rawResponse = await deps.runConsolidationModel(prompt)
    let response: ConsolidationResponse
    try {
      response = JSON.parse(rawResponse) as ConsolidationResponse
    } catch {
      deps.log('[dream] consolidate: failed to parse model response')
      return result
    }

    // Validate response structure
    if (!response || typeof response !== 'object') {
      deps.log('[dream] consolidate: invalid response structure')
      return result
    }

    const merges = Array.isArray(response.merges) ? response.merges : []
    const prunes = Array.isArray(response.prunes) ? response.prunes : []
    const updates = Array.isArray(response.updates) ? response.updates : []

    // Track IDs consumed by merges/prunes so updates cannot resurrect them
    const consumedIds = new Set<string>()

    // Apply merges — create merged doc first, then remove sources
    for (const merge of merges) {
      if (!Array.isArray(merge.sourceIds) || merge.sourceIds.length === 0) continue
      if (!merge.mergedDoc || typeof merge.mergedDoc.title !== 'string') continue

      // Refuse to merge user-locked docs
      const hasUserLocked = merge.sourceIds.some((id) => {
        const doc = docMap.get(id)
        return doc != null && USER_LOCKED_SOURCES.has(doc.source)
      })
      if (hasUserLocked) {
        deps.log(`[dream] consolidate: refusing to merge user-locked docs`)
        continue
      }

      // Create merged doc before removing sources to avoid data loss on failure
      const now = Date.now()
      const mergedDoc: MemdirDocument = {
        id: `dream-merged-${now}-${Math.random().toString(36).slice(2, 8)}`,
        type: isValidDocType(merge.mergedDoc.type) ? merge.mergedDoc.type : 'continuity',
        title: merge.mergedDoc.title,
        description: merge.mergedDoc.description ?? '',
        scopeKey: deps.memdirStore.scopeKey,
        updatedAt: now,
        source: 'extraction', // dream-managed docs inherit extraction source
        freshness: 'current',
        tags: Array.isArray(merge.mergedDoc.tags) ? merge.mergedDoc.tags : [],
      }
      await deps.memdirStore.putDocument(mergedDoc)

      // Remove source docs after merged doc is persisted
      for (const sourceId of merge.sourceIds) {
        await deps.memdirStore.removeDocument(sourceId)
        consumedIds.add(sourceId)
      }
      result.merged += merge.sourceIds.length
    }

    // ── Stage 4: Prune ──────────────────────────────────────────────
    deps.log('[dream] prune: processing prune list')
    for (const pruneId of prunes) {
      if (typeof pruneId !== 'string') continue
      const doc = docMap.get(pruneId)

      // Never prune user-locked docs
      if (doc != null && USER_LOCKED_SOURCES.has(doc.source)) {
        deps.log(`[dream] prune: refusing to prune user-locked doc ${pruneId}`)
        continue
      }

      await deps.memdirStore.removeDocument(pruneId)
      consumedIds.add(pruneId)
      result.pruned += 1
    }

    // Apply updates — skip IDs already consumed by merges or prunes
    for (const update of updates) {
      if (typeof update.id !== 'string') continue
      if (consumedIds.has(update.id)) {
        deps.log(`[dream] update: skipping consumed doc ${update.id}`)
        continue
      }
      const doc = docMap.get(update.id)
      if (doc == null) continue

      const patched: MemdirDocument = { ...doc }
      if (typeof update.description === 'string') {
        patched.description = update.description
      }
      if (typeof update.freshness === 'string' && isValidFreshness(update.freshness)) {
        patched.freshness = update.freshness
      }
      if (Array.isArray(update.tags)) {
        patched.tags = update.tags.filter((t): t is string => typeof t === 'string')
      }
      patched.updatedAt = Date.now()
      await deps.memdirStore.putDocument(patched)
      result.updated += 1
    }

    return result
  }

  return { shouldRun, run }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildConsolidationPrompt(docs: MemdirDocument[]): string {
  const lines = [
    'You are a memory consolidation assistant for a roleplay AI.',
    'Below is a list of memory documents. Identify duplicates to merge,',
    'stale or redundant entries to prune, and descriptions to update.',
    '',
    'Respond with a JSON object: { merges: [...], prunes: [...], updates: [...] }',
    '',
    'merges: [{ sourceIds: string[], mergedDoc: { type, title, description, tags } }]',
    'prunes: string[] (doc IDs to remove)',
    'updates: [{ id, description?, freshness?, tags? }]',
    '',
    'Documents:',
  ]

  for (const doc of docs) {
    lines.push(
      `- id: ${doc.id} | type: ${doc.type} | title: ${doc.title} | freshness: ${doc.freshness}`,
      `  description: ${doc.description}`,
      `  tags: ${doc.tags.join(', ') || '(none)'}`,
    )
  }

  return lines.join('\n')
}

const VALID_DOC_TYPES = new Set([
  'character', 'relationship', 'world', 'plot', 'continuity', 'operator',
])

function isValidDocType(type: string): type is MemdirDocument['type'] {
  return VALID_DOC_TYPES.has(type)
}

const VALID_FRESHNESS = new Set(['current', 'stale', 'archived'])

function isValidFreshness(value: string): value is MemdirDocument['freshness'] {
  return VALID_FRESHNESS.has(value)
}
