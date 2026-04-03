import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryAsyncStore } from './helpers/mockRisuai.js'
import {
  RefreshGuard,
  STABILIZATION_WINDOW_MS,
  type BlockStatus,
  type RefreshGuardSnapshot,
} from '../src/runtime/refreshGuard.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createGuard(scopeKey = 'test-scope'): {
  guard: RefreshGuard
  store: InMemoryAsyncStore
} {
  const store = new InMemoryAsyncStore()
  const guard = new RefreshGuard(store, scopeKey)
  return { guard, store }
}

// ---------------------------------------------------------------------------
// Tests — Snapshot persistence
// ---------------------------------------------------------------------------

describe('RefreshGuard — snapshot persistence', () => {
  it('starts with zero timestamps and null kind', () => {
    const { guard } = createGuard()
    const snap = guard.getSnapshot()
    expect(snap.startupTs).toBe(0)
    expect(snap.shutdownTs).toBe(0)
    expect(snap.maintenanceTs).toBe(0)
    expect(snap.maintenanceKind).toBeNull()
  })

  it('persists and reloads markStartup', async () => {
    const { guard, store } = createGuard()
    await guard.markStartup()
    const snap1 = guard.getSnapshot()
    expect(snap1.startupTs).toBeGreaterThan(0)

    // Reload into a new guard
    const guard2 = new RefreshGuard(store, 'test-scope')
    await guard2.load()
    const snap2 = guard2.getSnapshot()
    expect(snap2.startupTs).toBe(snap1.startupTs)
  })

  it('persists and reloads markShutdown', async () => {
    const { guard, store } = createGuard()
    await guard.markShutdown()
    const snap1 = guard.getSnapshot()
    expect(snap1.shutdownTs).toBeGreaterThan(0)

    const guard2 = new RefreshGuard(store, 'test-scope')
    await guard2.load()
    expect(guard2.getSnapshot().shutdownTs).toBe(snap1.shutdownTs)
  })

  it('persists and reloads markMaintenance with kind', async () => {
    const { guard, store } = createGuard()
    await guard.markMaintenance('backfill-current-chat')
    const snap1 = guard.getSnapshot()
    expect(snap1.maintenanceTs).toBeGreaterThan(0)
    expect(snap1.maintenanceKind).toBe('backfill-current-chat')

    const guard2 = new RefreshGuard(store, 'test-scope')
    await guard2.load()
    const snap2 = guard2.getSnapshot()
    expect(snap2.maintenanceTs).toBe(snap1.maintenanceTs)
    expect(snap2.maintenanceKind).toBe('backfill-current-chat')
  })

  it('load handles missing data gracefully', async () => {
    const { guard } = createGuard()
    await guard.load()
    const snap = guard.getSnapshot()
    expect(snap.startupTs).toBe(0)
    expect(snap.shutdownTs).toBe(0)
    expect(snap.maintenanceTs).toBe(0)
    expect(snap.maintenanceKind).toBeNull()
  })

  it('load handles corrupted data gracefully', async () => {
    const { guard, store } = createGuard()
    await store.setItem('director:refresh-guard:test-scope', 'not-an-object')
    await guard.load()
    expect(guard.getSnapshot().startupTs).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Tests — Block reason windows
// ---------------------------------------------------------------------------

describe('RefreshGuard — block reason windows', () => {
  it('reports not blocked when no timestamps are set', () => {
    const { guard } = createGuard()
    const status = guard.checkBlocked()
    expect(status.blocked).toBe(false)
    expect(status.reason).toBeNull()
  })

  it('reports blocked by startup when startupTs is within the window', async () => {
    const { guard } = createGuard()
    await guard.markStartup()
    const now = Date.now()
    const status = guard.checkBlocked(now)
    expect(status.blocked).toBe(true)
    expect(status.reason).toBe('startup')
  })

  it('reports not blocked after the stabilization window expires', async () => {
    const { guard } = createGuard()
    await guard.markStartup()
    const snap = guard.getSnapshot()
    const afterWindow = snap.startupTs + STABILIZATION_WINDOW_MS + 1
    const status = guard.checkBlocked(afterWindow)
    expect(status.blocked).toBe(false)
    expect(status.reason).toBeNull()
  })

  it('reports blocked by shutdown when shutdownTs is within the window', async () => {
    const { guard } = createGuard()
    await guard.markShutdown()
    const status = guard.checkBlocked(Date.now())
    expect(status.blocked).toBe(true)
    expect(status.reason).toBe('shutdown')
  })

  it('reports blocked by maintenance when maintenanceTs is within the window', async () => {
    const { guard } = createGuard()
    await guard.markMaintenance('bulk-delete-memory')
    const status = guard.checkBlocked(Date.now())
    expect(status.blocked).toBe(true)
    expect(status.reason).toBe('maintenance')
  })

  it('startup takes precedence over shutdown when both are active', async () => {
    const { guard } = createGuard()
    await guard.markShutdown()
    await guard.markStartup()
    const status = guard.checkBlocked(Date.now())
    expect(status.blocked).toBe(true)
    // checkBlocked checks startup first
    expect(status.reason).toBe('startup')
  })

  it('latestGuardTs returns the maximum of all timestamps', async () => {
    const { guard } = createGuard()
    await guard.markStartup()
    const afterStartup = guard.latestGuardTs()

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 5))
    await guard.markMaintenance('force-dream')
    const afterMaint = guard.latestGuardTs()

    expect(afterMaint).toBeGreaterThanOrEqual(afterStartup)
  })
})

// ---------------------------------------------------------------------------
// Tests — Scoped storage keys
// ---------------------------------------------------------------------------

describe('RefreshGuard — scoped keys', () => {
  it('different scope keys produce independent snapshots', async () => {
    const store = new InMemoryAsyncStore()
    const guardA = new RefreshGuard(store, 'scope-a')
    const guardB = new RefreshGuard(store, 'scope-b')

    await guardA.markStartup()
    await guardB.load()
    // guardB should not see guardA's startup
    expect(guardB.getSnapshot().startupTs).toBe(0)
  })
})
