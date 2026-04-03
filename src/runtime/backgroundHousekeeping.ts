import type { ExtractionContext } from '../memory/extractMemories.js'

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

export interface BackgroundHousekeeping {
  /** Called after a turn is finalized. Coalesces rapid calls. */
  afterTurn(ctx: ExtractionContext): Promise<void>
  /** Graceful shutdown — flush remaining work. */
  shutdown(): Promise<void>
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Cooperative housekeeping layer that coalesces rapid afterTurn calls
 * and delegates to the extraction worker. Since the RisuAI Plugin V3
 * runtime has no true background daemon, this is entirely hook-driven.
 */
export function createBackgroundHousekeeping(
  deps: HousekeepingDeps,
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

  async function afterTurn(ctx: ExtractionContext): Promise<void> {
    pendingCtx = ctx

    if (!scheduled) {
      scheduled = true
      // Use microtask to coalesce synchronous/rapid calls
      await Promise.resolve()
      await drainPending()
    }
  }

  async function shutdown(): Promise<void> {
    await drainPending()
    await deps.flushExtraction()
  }

  return { afterTurn, shutdown }
}
