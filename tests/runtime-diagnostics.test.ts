import { DiagnosticsManager, createDefaultDiagnosticsSnapshot, diagnosticsStorageKey } from '../src/runtime/diagnostics.js'
import { InMemoryAsyncStore } from './helpers/mockRisuai.js'

describe('DiagnosticsManager', () => {
  let storage: InMemoryAsyncStore

  beforeEach(() => {
    storage = new InMemoryAsyncStore()
  })

  // ── defaults ────────────────────────────────────────────────────────

  test('creates a default snapshot with all fields zeroed/null', () => {
    const snap = createDefaultDiagnosticsSnapshot()
    expect(snap.lastHookKind).toBeNull()
    expect(snap.lastHookTs).toBe(0)
    expect(snap.lastErrorMessage).toBeNull()
    expect(snap.lastErrorTs).toBe(0)
    expect(snap.extraction.health).toBe('idle')
    expect(snap.dream.health).toBe('idle')
    expect(snap.recovery.health).toBe('idle')
    expect(snap.breadcrumbs).toEqual([])
  })

  // ── storage key ─────────────────────────────────────────────────────

  test('produces a scoped storage key', () => {
    expect(diagnosticsStorageKey('my-scope')).toBe('continuity-director-diagnostics-v1:my-scope')
  })

  // ── loadSnapshot ────────────────────────────────────────────────────

  test('loadSnapshot returns defaults when storage is empty', async () => {
    const mgr = new DiagnosticsManager(storage, 'scope1')
    const snap = await mgr.loadSnapshot()
    expect(snap.lastHookKind).toBeNull()
    expect(snap.breadcrumbs).toEqual([])
  })

  test('loadSnapshot restores a previously persisted snapshot', async () => {
    const mgr = new DiagnosticsManager(storage, 'scope1')
    await mgr.recordHook('beforeRequest', 'normal')
    await mgr.recordError('test', new Error('boom'))

    const mgr2 = new DiagnosticsManager(storage, 'scope1')
    const snap = await mgr2.loadSnapshot()
    expect(snap.lastHookKind).toBe('beforeRequest')
    expect(snap.lastErrorMessage).toBe('boom')
    expect(snap.breadcrumbs.length).toBe(2)
  })

  // ── recordHook ──────────────────────────────────────────────────────

  test('recordHook updates lastHookKind and adds a breadcrumb', async () => {
    const mgr = new DiagnosticsManager(storage, 'scope1')
    await mgr.recordHook('afterRequest', 'normal')
    const snap = mgr.getSnapshot()
    expect(snap.lastHookKind).toBe('afterRequest')
    expect(snap.lastHookTs).toBeGreaterThan(0)
    expect(snap.breadcrumbs).toHaveLength(1)
    expect(snap.breadcrumbs[0]!.label).toBe('hook:afterRequest')
  })

  // ── recordError ─────────────────────────────────────────────────────

  test('recordError updates lastErrorMessage and adds a breadcrumb', async () => {
    const mgr = new DiagnosticsManager(storage, 'scope1')
    await mgr.recordError('preRequest', new Error('timeout'))
    const snap = mgr.getSnapshot()
    expect(snap.lastErrorMessage).toBe('timeout')
    expect(snap.lastErrorTs).toBeGreaterThan(0)
    expect(snap.breadcrumbs[0]!.label).toBe('error:preRequest')
  })

  test('recordError accepts string errors', async () => {
    const mgr = new DiagnosticsManager(storage, 'scope1')
    await mgr.recordError('test', 'string error')
    const snap = mgr.getSnapshot()
    expect(snap.lastErrorMessage).toBe('string error')
  })

  // ── recordWorkerSuccess / recordWorkerFailure ───────────────────────

  test('recordWorkerSuccess sets health to ok', async () => {
    const mgr = new DiagnosticsManager(storage, 'scope1')
    await mgr.recordWorkerSuccess('extraction', 'applied=true')
    const snap = mgr.getSnapshot()
    expect(snap.extraction.health).toBe('ok')
    expect(snap.extraction.lastDetail).toBe('applied=true')
    expect(snap.breadcrumbs[0]!.label).toBe('worker:extraction:ok')
  })

  test('recordWorkerFailure sets health to error and updates lastErrorMessage', async () => {
    const mgr = new DiagnosticsManager(storage, 'scope1')
    await mgr.recordWorkerFailure('dream', new Error('network'))
    const snap = mgr.getSnapshot()
    expect(snap.dream.health).toBe('error')
    expect(snap.dream.lastDetail).toBe('network')
    expect(snap.lastErrorMessage).toBe('network')
  })

  // ── recordRecovery ──────────────────────────────────────────────────

  test('recordRecovery with ok sets recovery health to ok', async () => {
    const mgr = new DiagnosticsManager(storage, 'scope1')
    await mgr.recordRecovery('ok', 'clean startup')
    const snap = mgr.getSnapshot()
    expect(snap.recovery.health).toBe('ok')
    expect(snap.recovery.lastDetail).toBe('clean startup')
  })

  test('recordRecovery with error sets recovery health to error', async () => {
    const mgr = new DiagnosticsManager(storage, 'scope1')
    await mgr.recordRecovery('error', 'crashed')
    const snap = mgr.getSnapshot()
    expect(snap.recovery.health).toBe('error')
  })

  test('recordRecovery with skipped sets recovery health to ok', async () => {
    const mgr = new DiagnosticsManager(storage, 'scope1')
    await mgr.recordRecovery('skipped')
    const snap = mgr.getSnapshot()
    expect(snap.recovery.health).toBe('ok')
  })

  // ── ring buffer truncation ──────────────────────────────────────────

  test('breadcrumbs are truncated to MAX_BREADCRUMBS (16)', async () => {
    const mgr = new DiagnosticsManager(storage, 'scope1')
    for (let i = 0; i < 25; i++) {
      await mgr.recordHook('beforeRequest', `turn-${i}`)
    }
    const snap = mgr.getSnapshot()
    expect(snap.breadcrumbs).toHaveLength(16)
    // Most recent should be the last recorded
    expect(snap.breadcrumbs[15]!.detail).toBe('turn-24')
    // Oldest should be turn-9 (25 - 16 = 9)
    expect(snap.breadcrumbs[0]!.detail).toBe('turn-9')
  })

  test('loadSnapshot respects MAX_BREADCRUMBS on corrupted data', async () => {
    // Simulate storing more than MAX_BREADCRUMBS
    const key = diagnosticsStorageKey('scope1')
    const bigBreadcrumbs = Array.from({ length: 30 }, (_, i) => ({
      ts: i,
      label: `item-${i}`,
    }))
    await storage.setItem(key, {
      lastHookKind: 'beforeRequest',
      lastHookTs: 100,
      lastErrorMessage: null,
      lastErrorTs: 0,
      extraction: { health: 'idle', lastTs: 0 },
      dream: { health: 'idle', lastTs: 0 },
      recovery: { health: 'idle', lastTs: 0 },
      breadcrumbs: bigBreadcrumbs,
    })

    const mgr = new DiagnosticsManager(storage, 'scope1')
    const snap = await mgr.loadSnapshot()
    expect(snap.breadcrumbs).toHaveLength(16)
  })

  // ── persistence across instances ────────────────────────────────────

  test('worker status persists across manager instances', async () => {
    const mgr1 = new DiagnosticsManager(storage, 'scope1')
    await mgr1.recordWorkerSuccess('extraction', 'done')
    await mgr1.recordWorkerFailure('dream', new Error('fail'))
    await mgr1.recordRecovery('ok')

    const mgr2 = new DiagnosticsManager(storage, 'scope1')
    const snap = await mgr2.loadSnapshot()
    expect(snap.extraction.health).toBe('ok')
    expect(snap.dream.health).toBe('error')
    expect(snap.recovery.health).toBe('ok')
  })

  // ── scope isolation ─────────────────────────────────────────────────

  test('different scopes are isolated', async () => {
    const mgr1 = new DiagnosticsManager(storage, 'scope-a')
    await mgr1.recordHook('beforeRequest')

    const mgr2 = new DiagnosticsManager(storage, 'scope-b')
    const snap = await mgr2.loadSnapshot()
    expect(snap.lastHookKind).toBeNull()
    expect(snap.breadcrumbs).toHaveLength(0)
  })

  // ── getSnapshot returns a copy ──────────────────────────────────────

  test('getSnapshot returns a deep clone', async () => {
    const mgr = new DiagnosticsManager(storage, 'scope1')
    await mgr.recordHook('output')
    const snap1 = mgr.getSnapshot()
    const snap2 = mgr.getSnapshot()
    expect(snap1).toEqual(snap2)
    snap1.breadcrumbs.push({ ts: 999, label: 'mutated' })
    expect(mgr.getSnapshot().breadcrumbs).toHaveLength(1)
  })
})
