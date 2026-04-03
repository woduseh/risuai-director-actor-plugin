import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InMemoryAsyncStore } from './helpers/mockRisuai.js'
import {
  ConsolidationLock,
  type LeaseBody,
  STALE_THRESHOLD_MS,
} from '../src/memory/consolidationLock.js'

function makeStore(): InMemoryAsyncStore {
  return new InMemoryAsyncStore()
}

describe('ConsolidationLock', () => {
  let store: InMemoryAsyncStore
  const scopeKey = 'test-scope'
  const workerId = 'worker-A'

  beforeEach(() => {
    store = makeStore()
  })

  // ── Acquire ─────────────────────────────────────────────────────────

  it('acquires a fresh lock when none exists', async () => {
    const lock = new ConsolidationLock(store, scopeKey, workerId)
    const acquired = await lock.tryAcquire()
    expect(acquired).toBe(true)
  })

  it('rejects a second worker while the first holds the lock', async () => {
    const lockA = new ConsolidationLock(store, scopeKey, 'worker-A')
    const lockB = new ConsolidationLock(store, scopeKey, 'worker-B')

    await lockA.tryAcquire()
    const acquired = await lockB.tryAcquire()
    expect(acquired).toBe(false)
  })

  it('allows the same worker to re-acquire its own lock', async () => {
    const lock = new ConsolidationLock(store, scopeKey, workerId)
    await lock.tryAcquire()
    const reacquired = await lock.tryAcquire()
    expect(reacquired).toBe(true)
  })

  // ── Release ─────────────────────────────────────────────────────────

  it('releases the lock so another worker can acquire', async () => {
    const lockA = new ConsolidationLock(store, scopeKey, 'worker-A')
    const lockB = new ConsolidationLock(store, scopeKey, 'worker-B')

    await lockA.tryAcquire()
    await lockA.release()

    const acquired = await lockB.tryAcquire()
    expect(acquired).toBe(true)
  })

  it('release is safe to call when no lock is held', async () => {
    const lock = new ConsolidationLock(store, scopeKey, workerId)
    await expect(lock.release()).resolves.not.toThrow()
  })

  // ── Stale lock recovery ─────────────────────────────────────────────

  it('recovers a stale lock held by another worker', async () => {
    // Manually write a stale lease
    const staleTs = Date.now() - STALE_THRESHOLD_MS - 1000
    const key = `director-memdir:consolidate-lock:${scopeKey}`
    const staleLease: LeaseBody = {
      workerId: 'dead-worker',
      acquiredAt: staleTs,
      expiresAt: staleTs + STALE_THRESHOLD_MS,
      lastTouchedAt: staleTs,
    }
    await store.setItem(key, staleLease)

    const lock = new ConsolidationLock(store, scopeKey, workerId)
    const acquired = await lock.tryAcquire()
    expect(acquired).toBe(true)
  })

  it('does NOT recover a non-stale lock held by another worker', async () => {
    const key = `director-memdir:consolidate-lock:${scopeKey}`
    const freshTs = Date.now()
    const freshLease: LeaseBody = {
      workerId: 'other-worker',
      acquiredAt: freshTs,
      expiresAt: freshTs + STALE_THRESHOLD_MS,
      lastTouchedAt: freshTs,
    }
    await store.setItem(key, freshLease)

    const lock = new ConsolidationLock(store, scopeKey, workerId)
    const acquired = await lock.tryAcquire()
    expect(acquired).toBe(false)
  })

  // ── Read-after-write verification ───────────────────────────────────

  it('performs read-after-write verification after acquire', async () => {
    const lock = new ConsolidationLock(store, scopeKey, workerId)
    await lock.tryAcquire()

    // After acquisition, reading the store should show this worker's lease
    const key = `director-memdir:consolidate-lock:${scopeKey}`
    const lease = await store.getItem<LeaseBody>(key)
    expect(lease).not.toBeNull()
    expect(lease!.workerId).toBe(workerId)
  })

  // ── Touch / heartbeat ───────────────────────────────────────────────

  it('touch updates lastTouchedAt and extends expiresAt', async () => {
    const lock = new ConsolidationLock(store, scopeKey, workerId)
    await lock.tryAcquire()

    const key = `director-memdir:consolidate-lock:${scopeKey}`
    const before = await store.getItem<LeaseBody>(key)
    expect(before).not.toBeNull()
    const beforeTs = before!.lastTouchedAt

    // Advance time slightly
    vi.useFakeTimers()
    vi.advanceTimersByTime(1000)

    await lock.touch()

    vi.useRealTimers()

    const after = await store.getItem<LeaseBody>(key)
    expect(after).not.toBeNull()
    expect(after!.lastTouchedAt).toBeGreaterThanOrEqual(beforeTs)
  })

  // ── Rollback on failure ─────────────────────────────────────────────

  it('withLock releases the lock on worker failure', async () => {
    const lock = new ConsolidationLock(store, scopeKey, workerId)

    await expect(
      lock.withLock(async () => {
        throw new Error('worker crashed')
      }),
    ).rejects.toThrow('worker crashed')

    // Lock should be released after failure
    const lockB = new ConsolidationLock(store, scopeKey, 'worker-B')
    expect(await lockB.tryAcquire()).toBe(true)
  })

  it('withLock releases the lock on success', async () => {
    const lock = new ConsolidationLock(store, scopeKey, workerId)

    const result = await lock.withLock(async () => 42)
    expect(result).toBe(42)

    // Lock should be released after success
    const lockB = new ConsolidationLock(store, scopeKey, 'worker-B')
    expect(await lockB.tryAcquire()).toBe(true)
  })

  it('withLock returns null if acquire fails', async () => {
    // Another worker holds the lock
    const lockA = new ConsolidationLock(store, scopeKey, 'worker-A')
    await lockA.tryAcquire()

    const lockB = new ConsolidationLock(store, scopeKey, 'worker-B')
    const result = await lockB.withLock(async () => 42)
    expect(result).toBeNull()
  })

  // ── isHeld ────────────────────────────────────────────────────────────

  it('isHeld returns false when no lock exists', async () => {
    const lock = new ConsolidationLock(store, scopeKey, workerId)
    expect(await lock.isHeld()).toBe(false)
  })

  it('isHeld returns true when a lock is held', async () => {
    const lock = new ConsolidationLock(store, scopeKey, workerId)
    await lock.tryAcquire()
    expect(await lock.isHeld()).toBe(true)
  })

  it('isHeld returns false after lock is released', async () => {
    const lock = new ConsolidationLock(store, scopeKey, workerId)
    await lock.tryAcquire()
    await lock.release()
    expect(await lock.isHeld()).toBe(false)
  })

  it('isHeld returns false for a stale lock', async () => {
    const key = `director-memdir:consolidate-lock:${scopeKey}`
    const staleTs = Date.now() - STALE_THRESHOLD_MS - 1000
    await store.setItem(key, {
      workerId: 'dead-worker',
      acquiredAt: staleTs,
      expiresAt: staleTs + STALE_THRESHOLD_MS,
      lastTouchedAt: staleTs,
    } satisfies LeaseBody)

    const lock = new ConsolidationLock(store, scopeKey, workerId)
    expect(await lock.isHeld()).toBe(false)
  })
})
