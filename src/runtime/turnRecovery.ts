import type { AsyncKeyValueStore } from '../contracts/risuai.js'
import type { DirectorPostResponseInput } from './plugin.js'
import type { ExtractionContext } from '../memory/extractMemories.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Discriminated stages for the pending turn lifecycle. */
export type PendingTurnStage = 'post-response-pending' | 'housekeeping-pending'

/** Schema version for forward-compatible deserialization. */
const PENDING_TURN_SCHEMA_VERSION = 1

/**
 * Durable record persisted to pluginStorage while a turn is in-flight.
 * Contains enough context to replay from the current stage on next startup.
 */
export interface PendingTurnRecord {
  schemaVersion: number
  turnId: string
  turnIndex: number
  stage: PendingTurnStage
  /** Serialisable snapshot of the DirectorPostResponseInput. */
  postInput: DirectorPostResponseInput
  createdAt: number
  updatedAt: number
}

/** Narrow interface so bootstrapPlugin can consume without hard-coupling. */
export interface TurnRecoveryManager {
  /** Persist a new pending record at the post-response-pending stage. */
  persist(turnIndex: number, postInput: DirectorPostResponseInput): Promise<void>
  /** Advance an existing record to housekeeping-pending. */
  advance(turnId: string): Promise<void>
  /** Clear the record (turn fully complete). */
  clear(): Promise<void>
  /** Load the current pending record, if any. */
  load(): Promise<PendingTurnRecord | null>
}

/** Dependencies injected for startup recovery replay. */
export interface RecoveryReplayDeps {
  /** Replay director.postResponse(). */
  postResponse(input: DirectorPostResponseInput): Promise<void>
  /** Replay housekeeping/extraction for the saved context. */
  runHousekeeping(ctx: ExtractionContext): Promise<void>
  /** Log a message. */
  log(message: string): void
}

// ---------------------------------------------------------------------------
// Storage key derivation
// ---------------------------------------------------------------------------

/** Derive a scoped pluginStorage key for the pending-turn record. */
export function pendingTurnStorageKey(scopeKey: string): string {
  return `continuity-director:pending-turn:${scopeKey}`
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a TurnRecoveryManager backed by pluginStorage.
 *
 * @param storage - The plugin's async key-value store.
 * @param scopeKey - Active scope key (used to namespace the record).
 */
export function createTurnRecoveryManager(
  storage: AsyncKeyValueStore,
  scopeKey: string,
): TurnRecoveryManager {
  const key = pendingTurnStorageKey(scopeKey)

  return {
    async persist(turnIndex, postInput) {
      const now = Date.now()
      const record: PendingTurnRecord = {
        schemaVersion: PENDING_TURN_SCHEMA_VERSION,
        turnId: postInput.turnId,
        turnIndex,
        stage: 'post-response-pending',
        postInput,
        createdAt: now,
        updatedAt: now,
      }
      await storage.setItem(key, record)
    },

    async advance(turnId) {
      const existing = await storage.getItem<PendingTurnRecord>(key)
      if (!existing || existing.turnId !== turnId) return
      const advanced: PendingTurnRecord = {
        ...existing,
        stage: 'housekeeping-pending',
        updatedAt: Date.now(),
      }
      await storage.setItem(key, advanced)
    },

    async clear() {
      await storage.removeItem(key)
    },

    async load() {
      const raw = await storage.getItem<PendingTurnRecord>(key)
      if (!raw) return null
      if (
        typeof raw !== 'object' ||
        raw.schemaVersion !== PENDING_TURN_SCHEMA_VERSION
      ) {
        // Incompatible or corrupt — discard silently.
        await storage.removeItem(key)
        return null
      }
      return raw
    },
  }
}

// ---------------------------------------------------------------------------
// Startup recovery
// ---------------------------------------------------------------------------

/**
 * Attempt to recover a pending turn from a previous session.
 * Returns true if recovery was attempted (regardless of success),
 * false if no pending record existed.
 *
 * On failure the record is left intact so a future startup can retry.
 */
export async function attemptStartupRecovery(
  manager: TurnRecoveryManager,
  deps: RecoveryReplayDeps,
): Promise<boolean> {
  const record = await manager.load()
  if (!record) return false

  deps.log(
    `[turn-recovery] Found pending turn ${record.turnId} at stage=${record.stage}`,
  )

  try {
    if (record.stage === 'post-response-pending') {
      await deps.postResponse(record.postInput)
      await manager.advance(record.turnId)
    }

    // At this point stage is housekeeping-pending (either originally or
    // after successful advance above).
    const ctx: ExtractionContext = {
      turnId: record.postInput.turnId,
      turnIndex: record.turnIndex,
      type: record.postInput.type,
      content: record.postInput.content,
      messages: record.postInput.messages,
      brief: record.postInput.brief,
    }

    await deps.runHousekeeping(ctx)
    await manager.clear()
    deps.log(`[turn-recovery] Successfully recovered turn ${record.turnId}`)
  } catch (err) {
    // Leave record intact for next startup attempt.
    deps.log(
      `[turn-recovery] Recovery failed for turn ${record.turnId}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  return true
}
