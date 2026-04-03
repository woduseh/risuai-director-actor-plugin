import type {
  HookRequestType,
  MemoryUpdate,
  OpenAIChat,
  SceneBrief,
} from '../contracts/types.js'
import { withRetry, type RetryOptions } from '../runtime/network.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Context needed by the extraction worker to process a finalized turn. */
export interface ExtractionContext {
  turnId: string
  turnIndex: number
  type: HookRequestType
  content: string
  messages: OpenAIChat[]
  brief: SceneBrief
}

/** Result returned by the extraction delegate. */
export interface ExtractionResult {
  applied: boolean
  memoryUpdate: MemoryUpdate | null
}

/** Injectable dependencies for the extraction worker. */
export interface ExtractionWorkerDeps {
  /** Execute the actual Director post-response extraction for a turn. */
  runExtraction(ctx: ExtractionContext): Promise<ExtractionResult>
  /** Persist extracted results as memdir documents. */
  persistDocuments(update: MemoryUpdate, ctx: ExtractionContext): Promise<void>
  /** Log a message. */
  log(message: string): void
  /** Read the last extraction timestamp from hot cache. */
  getLastExtractionTs(): Promise<number>
  /** Write the last extraction timestamp to hot cache. */
  setLastExtractionTs(ts: number): Promise<void>
  /** Read the last-processed turn cursor from hot cache. */
  getLastProcessedCursor(): Promise<number>
  /** Write the last-processed turn cursor to hot cache. */
  setLastProcessedCursor(cursor: number): Promise<void>
  /** Produce a fast content hash for duplicate detection. */
  hashRequest(ctx: ExtractionContext): string
}

export interface ExtractionWorkerOptions {
  /** Minimum turn interval before extraction fires again. */
  extractionMinTurnInterval: number
  /** Shared set used for hash-based duplicate skip (hot cache). */
  seenHashes?: Set<string>
  /** Retry options for transient extraction failures. */
  retryOptions?: RetryOptions
}

export interface ExtractionWorker {
  /** Submit a finalized turn for extraction. Coalesces rapid calls. */
  submit(ctx: ExtractionContext): Promise<void>
  /** Flush the pending context (if any) through extraction. */
  flush(): Promise<void>
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const MAX_SEEN_HASHES = 200

export function createExtractionWorker(
  deps: ExtractionWorkerDeps,
  options: ExtractionWorkerOptions,
): ExtractionWorker {
  const seenHashes = options.seenHashes ?? new Set<string>()
  let pending: ExtractionContext | null = null
  let inFlight: Promise<void> | null = null
  let drainScheduled = false

  async function runOne(ctx: ExtractionContext): Promise<void> {
    // Hash-based duplicate skip
    const hash = deps.hashRequest(ctx)
    if (seenHashes.has(hash)) {
      return
    }

    // Turn-interval gate — only suppress when the gap is positive but
    // below the threshold.  A non-positive gap means the session-local
    // turnIndex has reset (plugin reload) and the persisted cursor is
    // stale; in that case we must *not* suppress extraction.
    const lastCursor = await deps.getLastProcessedCursor()
    const gap = ctx.turnIndex - lastCursor
    if (lastCursor > 0 && gap > 0 && gap < options.extractionMinTurnInterval) {
      return
    }

    try {
      const retryOpts: RetryOptions = {
        ...options.retryOptions,
        log: (msg) => deps.log(`[extraction-worker] ${msg}`),
      }
      const result = await withRetry(
        () => deps.runExtraction(ctx),
        retryOpts,
      )

      // Persist documents *before* recording success markers so that a
      // persistence failure leaves the turn retryable on next attempt.
      if (result.applied && result.memoryUpdate) {
        await deps.persistDocuments(result.memoryUpdate, ctx)
      }

      // Record hash only after persistence succeeds
      seenHashes.add(hash)
      if (seenHashes.size > MAX_SEEN_HASHES) {
        const first = seenHashes.values().next().value
        if (first !== undefined) seenHashes.delete(first)
      }

      // Update cursor after persistence succeeds
      await deps.setLastProcessedCursor(ctx.turnIndex)
      await deps.setLastExtractionTs(Date.now())
    } catch (err) {
      deps.log(`[extraction-worker] Extraction failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function drainPending(): Promise<void> {
    while (pending !== null) {
      const ctx = pending
      pending = null
      await runOne(ctx)
    }
  }

  /**
   * Schedule a deferred drain via microtask. This enables coalescing:
   * multiple rapid submit() calls replace the pending slot before the
   * drain runs, so only the last context is processed.
   */
  function scheduleDrain(): void {
    if (drainScheduled || inFlight !== null) return
    drainScheduled = true
    void Promise.resolve().then(async () => {
      drainScheduled = false
      if (inFlight !== null || pending === null) return
      inFlight = drainPending()
      try {
        await inFlight
      } finally {
        inFlight = null
      }
    })
  }

  async function submit(ctx: ExtractionContext): Promise<void> {
    pending = ctx
    scheduleDrain()
  }

  async function flush(): Promise<void> {
    // Wait for any in-flight extraction to finish
    if (inFlight !== null) {
      await inFlight
    }
    // Force-drain any remaining pending context
    if (pending !== null) {
      inFlight = drainPending()
      try {
        await inFlight
      } finally {
        inFlight = null
      }
    }
  }

  return { submit, flush }
}
