import type { ExtractionContext } from '../memory/extractMemories.js'
import type { DreamCadenceGate, AutoDreamWorker, DreamResult } from '../memory/autoDream.js'
import type { ConsolidationLock } from '../memory/consolidationLock.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface HousekeepingDeps {
  /** Forward a context to the extraction worker. */
  submitExtraction(ctx: ExtractionContext): Promise<void>
  /** Flush any pending extraction work. */
  flushExtraction(): Promise<void>
  /** Read the current extraction-min-turn-interval setting. */
  getExtractionMinTurnInterval(): number
  /** Log a message. */
  log(message: string): void
}

export interface DreamHousekeepingDeps {
  /** Build the cadence gate snapshot from current runtime state. */
  buildCadenceGate(): DreamCadenceGate | Promise<DreamCadenceGate>
  /** The dream consolidation worker. */
  dreamWorker: AutoDreamWorker
  /** Cooperative lock for the consolidation scope. */
  consolidationLock: ConsolidationLock
  /** Called after a successful dream pass to persist the timestamp. */
  onDreamComplete(result: DreamResult): Promise<void>
  /** Log a message. */
  log(message: string): void
}

export interface BackgroundHousekeeping {
  /** Called after a turn is finalized. Coalesces rapid calls. */
  afterTurn(ctx: ExtractionContext): Promise<void>
  /** Graceful shutdown — flush remaining work. */
  shutdown(): Promise<void>
  /** Attempt a dream consolidation pass (gated). */
  tryDream(): Promise<DreamResult | null>
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Cooperative housekeeping layer that coalesces rapid afterTurn calls
 * and delegates to the extraction worker. Since the RisuAI Plugin V3
 * runtime has no true background daemon, this is entirely hook-driven.
 *
 * When dream deps are provided, afterTurn will also attempt a
 * consolidation pass after extraction — gated by cadence thresholds
 * and a cooperative lock.
 */
export function createBackgroundHousekeeping(
  deps: HousekeepingDeps,
  dreamDeps?: DreamHousekeepingDeps,
): BackgroundHousekeeping {
  let pendingCtx: ExtractionContext | null = null
  let scheduled = false

  async function drainPending(): Promise<void> {
    scheduled = false
    if (pendingCtx === null) return
    const ctx = pendingCtx
    pendingCtx = null
    try {
      await deps.submitExtraction(ctx)
    } catch (err) {
      deps.log(
        `[housekeeping] Extraction submission failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  async function tryDream(): Promise<DreamResult | null> {
    if (!dreamDeps) return null

    const gate = await dreamDeps.buildCadenceGate()
    if (!dreamDeps.dreamWorker.shouldRun(gate)) return null

    const result = await dreamDeps.consolidationLock.withLock(async () => {
      return dreamDeps.dreamWorker.run()
    })

    if (result != null) {
      await dreamDeps.onDreamComplete(result)
      dreamDeps.log(
        `[housekeeping] Dream pass complete: merged=${result.merged} pruned=${result.pruned} updated=${result.updated}`,
      )
    }

    return result
  }

  async function afterTurn(ctx: ExtractionContext): Promise<void> {
    pendingCtx = ctx

    if (!scheduled) {
      scheduled = true
      // Use microtask to coalesce synchronous/rapid calls
      await Promise.resolve()
      await drainPending()
    }

    // Opportunistic dream attempt — cheap gates first
    try {
      await tryDream()
    } catch (err) {
      deps.log(
        `[housekeeping] Dream attempt failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  async function shutdown(): Promise<void> {
    await drainPending()
    await deps.flushExtraction()
  }

  return { afterTurn, shutdown, tryDream }
}
