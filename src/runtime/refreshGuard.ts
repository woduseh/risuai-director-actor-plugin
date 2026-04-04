import type { AsyncKeyValueStore } from '../contracts/risuai.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Duration (ms) of the stabilization window after startup/shutdown/maintenance. */
export const STABILIZATION_WINDOW_MS = 10_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Reason codes for blocking heavy maintenance during an active stabilization window. */
export type BlockReason = 'startup' | 'shutdown' | 'maintenance'

/** Kind of maintenance activity that was stamped. */
export type MaintenanceKind =
  | 'backfill-current-chat'
  | 'regenerate-current-chat'
  | 'bulk-delete-memory'
  | 'force-dream'

export interface RefreshGuardSnapshot {
  /** Epoch ms when the most recent startup was marked. */
  startupTs: number
  /** Epoch ms when the most recent shutdown was marked. */
  shutdownTs: number
  /** Epoch ms when the most recent maintenance action started. */
  maintenanceTs: number
  /** Kind of the most recent maintenance action, if any. */
  maintenanceKind: MaintenanceKind | null
}

export interface BlockStatus {
  blocked: boolean
  reason: BlockReason | null
}

// ---------------------------------------------------------------------------
// Storage key helper
// ---------------------------------------------------------------------------

export function refreshGuardStorageKey(scopeKey: string): string {
  return `continuity-director:refresh-guard:${scopeKey}`
}

// ---------------------------------------------------------------------------
// Default snapshot
// ---------------------------------------------------------------------------

function createDefaultSnapshot(): RefreshGuardSnapshot {
  return {
    startupTs: 0,
    shutdownTs: 0,
    maintenanceTs: 0,
    maintenanceKind: null,
  }
}

// ---------------------------------------------------------------------------
// Snapshot normalization
// ---------------------------------------------------------------------------

function normalizeSnapshot(raw: unknown): RefreshGuardSnapshot {
  if (raw != null && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    return {
      startupTs: typeof r.startupTs === 'number' ? r.startupTs : 0,
      shutdownTs: typeof r.shutdownTs === 'number' ? r.shutdownTs : 0,
      maintenanceTs: typeof r.maintenanceTs === 'number' ? r.maintenanceTs : 0,
      maintenanceKind:
        typeof r.maintenanceKind === 'string'
          ? (r.maintenanceKind as MaintenanceKind)
          : null,
    }
  }
  return createDefaultSnapshot()
}

// ---------------------------------------------------------------------------
// RefreshGuard
// ---------------------------------------------------------------------------

/**
 * A small stabilization guard that prevents destructive maintenance work
 * from running during unstable startup/shutdown/reload windows.
 *
 * The guard stores timestamps in a fast local store (safeLocalStorage) and
 * considers a window "active" if any recorded timestamp falls within
 * {@link STABILIZATION_WINDOW_MS} of the current time.
 */
export class RefreshGuard {
  private snapshot: RefreshGuardSnapshot
  private readonly storage: AsyncKeyValueStore
  private readonly storageKey: string

  constructor(storage: AsyncKeyValueStore, scopeKey: string) {
    this.storage = storage
    this.storageKey = refreshGuardStorageKey(scopeKey)
    this.snapshot = createDefaultSnapshot()
  }

  // ── persistence ─────────────────────────────────────────────────────

  async load(): Promise<void> {
    const raw = await this.storage.getItem<RefreshGuardSnapshot>(this.storageKey)
    this.snapshot = normalizeSnapshot(raw)
  }

  private async persist(): Promise<void> {
    await this.storage.setItem(this.storageKey, structuredClone(this.snapshot))
  }

  // ── stamping ────────────────────────────────────────────────────────

  async markStartup(): Promise<void> {
    this.snapshot.startupTs = Date.now()
    await this.persist()
  }

  async markShutdown(): Promise<void> {
    this.snapshot.shutdownTs = Date.now()
    await this.persist()
  }

  async markMaintenance(kind: MaintenanceKind): Promise<void> {
    const now = Date.now()
    this.snapshot.maintenanceTs = now
    this.snapshot.maintenanceKind = kind
    await this.persist()
  }

  // ── query ───────────────────────────────────────────────────────────

  /**
   * Return the latest guard timestamp (max of startup, shutdown, maintenance).
   * Useful for extending the user-interaction guard in dream cadence gating.
   */
  latestGuardTs(): number {
    return Math.max(
      this.snapshot.startupTs,
      this.snapshot.shutdownTs,
      this.snapshot.maintenanceTs,
    )
  }

  /**
   * Check whether heavy maintenance is currently blocked by an active
   * stabilization window.  Returns a reason code if blocked.
   */
  checkBlocked(now?: number): BlockStatus {
    const ts = now ?? Date.now()

    if (ts - this.snapshot.startupTs < STABILIZATION_WINDOW_MS) {
      return { blocked: true, reason: 'startup' }
    }
    if (ts - this.snapshot.shutdownTs < STABILIZATION_WINDOW_MS) {
      return { blocked: true, reason: 'shutdown' }
    }
    if (ts - this.snapshot.maintenanceTs < STABILIZATION_WINDOW_MS) {
      return { blocked: true, reason: 'maintenance' }
    }

    return { blocked: false, reason: null }
  }

  /** Read-only access to the current snapshot (cloned). */
  getSnapshot(): RefreshGuardSnapshot {
    return structuredClone(this.snapshot)
  }
}
