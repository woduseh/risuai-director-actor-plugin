import type { AsyncKeyValueStore } from '../contracts/risuai.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** If a lock's lastTouchedAt is older than this, it's considered stale. */
export const STALE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

const LOCK_KEY_PREFIX = 'director-memdir:consolidate-lock'

// ---------------------------------------------------------------------------
// Lease schema
// ---------------------------------------------------------------------------

export interface LeaseBody {
  workerId: string
  acquiredAt: number
  expiresAt: number
  lastTouchedAt: number
}

// ---------------------------------------------------------------------------
// ConsolidationLock
// ---------------------------------------------------------------------------

/**
 * Cooperative lock backed by pluginStorage-based leases.
 *
 * Uses read-after-write verification to ensure that only one worker
 * proceeds with a consolidation pass within a given scope. Stale locks
 * (those whose `lastTouchedAt` exceeds {@link STALE_THRESHOLD_MS}) are
 * automatically recovered.
 */
export class ConsolidationLock {
  private readonly storage: AsyncKeyValueStore
  private readonly key: string
  private readonly workerId: string

  constructor(storage: AsyncKeyValueStore, scopeKey: string, workerId: string) {
    this.storage = storage
    this.key = `${LOCK_KEY_PREFIX}:${scopeKey}`
    this.workerId = workerId
  }

  // ── Acquire ───────────────────────────────────────────────────────

  /**
   * Try to acquire the consolidation lock.
   *
   * Returns `true` if this worker now holds the lock, `false` otherwise.
   * Performs read-after-write verification before returning `true`.
   */
  async tryAcquire(): Promise<boolean> {
    const existing = await this.storage.getItem<LeaseBody>(this.key)

    if (existing != null) {
      // Same worker — allow re-acquire (idempotent)
      if (existing.workerId === this.workerId) {
        return true
      }

      // Another worker — check if stale
      const now = Date.now()
      const isStale = now - existing.lastTouchedAt > STALE_THRESHOLD_MS
      if (!isStale) {
        return false
      }
      // stale — fall through to overwrite
    }

    // Write lease
    const now = Date.now()
    const lease: LeaseBody = {
      workerId: this.workerId,
      acquiredAt: now,
      expiresAt: now + STALE_THRESHOLD_MS,
      lastTouchedAt: now,
    }
    await this.storage.setItem(this.key, lease)

    // Read-after-write verification
    const readBack = await this.storage.getItem<LeaseBody>(this.key)
    if (readBack == null || readBack.workerId !== this.workerId) {
      return false
    }

    return true
  }

  // ── Release ───────────────────────────────────────────────────────

  /**
   * Release the lock. Safe to call even if we don't hold it.
   */
  async release(): Promise<void> {
    const existing = await this.storage.getItem<LeaseBody>(this.key)
    if (existing != null && existing.workerId === this.workerId) {
      await this.storage.removeItem(this.key)
    }
  }

  // ── Touch / heartbeat ─────────────────────────────────────────────

  /**
   * Update the lease timestamp to prevent stale-lock recovery.
   * Only touches if we own the lock.
   */
  async touch(): Promise<void> {
    const existing = await this.storage.getItem<LeaseBody>(this.key)
    if (existing == null || existing.workerId !== this.workerId) return

    const now = Date.now()
    const updated: LeaseBody = {
      ...existing,
      lastTouchedAt: now,
      expiresAt: now + STALE_THRESHOLD_MS,
    }
    await this.storage.setItem(this.key, updated)
  }

  // ── RAII-style helper ─────────────────────────────────────────────

  /**
   * Acquire, execute `fn`, then release — regardless of success or failure.
   * Returns `null` if acquisition failed (lock is held by another worker).
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T | null> {
    const acquired = await this.tryAcquire()
    if (!acquired) return null

    try {
      return await fn()
    } finally {
      await this.release()
    }
  }
}
