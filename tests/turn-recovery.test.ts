import { vi } from 'vitest'
import {
  createTurnRecoveryManager,
  attemptStartupRecovery,
  pendingTurnStorageKey,
  type PendingTurnRecord,
  type RecoveryReplayDeps,
  type TurnRecoveryManager,
} from '../src/runtime/turnRecovery.js'
import type { DirectorPostResponseInput } from '../src/runtime/plugin.js'
import { InMemoryAsyncStore } from './helpers/mockRisuai.js'
import { bootstrapPlugin } from '../src/runtime/plugin.js'
import { createMockRisuaiApi } from './helpers/mockRisuai.js'
import type { MemoryUpdate, SceneBrief } from '../src/contracts/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeBrief = (overrides?: Partial<SceneBrief>): SceneBrief => ({
  confidence: 0.95,
  pacing: 'steady',
  beats: [{ goal: 'Escalate', reason: 'Pressure needed' }],
  continuityLocks: ['The ring is still hidden.'],
  ensembleWeights: { A: 1 },
  styleInheritance: { genre: 'mythic' },
  forbiddenMoves: ['Do not reveal the secret.'],
  memoryHints: ['ring'],
  ...overrides,
})

const makeUpdate = (overrides?: Partial<MemoryUpdate>): MemoryUpdate => ({
  status: 'pass',
  turnScore: 0.8,
  violations: [],
  durableFacts: ['A sat down.'],
  sceneDelta: { scenePhase: 'aftermath', activeCharacters: ['A'] },
  entityUpdates: [],
  relationUpdates: [],
  memoryOps: [],
  ...overrides,
})

const makePostInput = (
  overrides?: Partial<DirectorPostResponseInput>,
): DirectorPostResponseInput => ({
  turnId: 'turn-abc',
  type: 'model',
  content: 'The actor speaks.',
  brief: makeBrief(),
  messages: [
    { role: 'system', content: 'Rules.' },
    { role: 'user', content: 'Go.' },
  ],
  originalMessages: [
    { role: 'system', content: 'Rules.' },
    { role: 'user', content: 'Go.' },
  ],
  ...overrides,
})

function makeReplayDeps(
  overrides?: Partial<RecoveryReplayDeps>,
): RecoveryReplayDeps & {
  postResponseCalls: DirectorPostResponseInput[]
  housekeepingCalls: unknown[]
  logs: string[]
} {
  const postResponseCalls: DirectorPostResponseInput[] = []
  const housekeepingCalls: unknown[] = []
  const logs: string[] = []
  return {
    postResponseCalls,
    housekeepingCalls,
    logs,
    async postResponse(input) {
      postResponseCalls.push(input)
    },
    async runHousekeeping(ctx) {
      housekeepingCalls.push(ctx)
    },
    log(msg) {
      logs.push(msg)
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Unit tests – TurnRecoveryManager
// ---------------------------------------------------------------------------

describe('TurnRecoveryManager', () => {
  let storage: InMemoryAsyncStore
  let manager: TurnRecoveryManager
  const scopeKey = 'test-scope'

  beforeEach(() => {
    storage = new InMemoryAsyncStore()
    manager = createTurnRecoveryManager(storage, scopeKey)
  })

  test('persist stores a recoverable record at post-response-pending', async () => {
    const postInput = makePostInput()

    await manager.persist(1, postInput)

    const stored = await storage.getItem<PendingTurnRecord>(
      pendingTurnStorageKey(scopeKey),
    )
    expect(stored).not.toBeNull()
    expect(stored!.turnId).toBe('turn-abc')
    expect(stored!.turnIndex).toBe(1)
    expect(stored!.stage).toBe('post-response-pending')
    expect(stored!.postInput.content).toBe('The actor speaks.')
  })

  test('advance moves stage to housekeeping-pending', async () => {
    const postInput = makePostInput()
    await manager.persist(1, postInput)

    await manager.advance('turn-abc')

    const record = await manager.load()
    expect(record).not.toBeNull()
    expect(record!.stage).toBe('housekeeping-pending')
  })

  test('advance is a no-op for mismatched turnId', async () => {
    const postInput = makePostInput()
    await manager.persist(1, postInput)

    await manager.advance('turn-wrong')

    const record = await manager.load()
    expect(record!.stage).toBe('post-response-pending')
  })

  test('clear removes the record', async () => {
    await manager.persist(1, makePostInput())
    await manager.clear()

    const record = await manager.load()
    expect(record).toBeNull()
  })

  test('load returns null when no record exists', async () => {
    const record = await manager.load()
    expect(record).toBeNull()
  })

  test('load discards records with wrong schemaVersion', async () => {
    const key = pendingTurnStorageKey(scopeKey)
    await storage.setItem(key, { schemaVersion: 999, turnId: 'old' })

    const record = await manager.load()
    expect(record).toBeNull()
    // Should also clean up
    const raw = await storage.getItem(key)
    expect(raw).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Unit tests – attemptStartupRecovery
// ---------------------------------------------------------------------------

describe('attemptStartupRecovery', () => {
  let storage: InMemoryAsyncStore
  let manager: TurnRecoveryManager
  const scopeKey = 'test-scope'

  beforeEach(() => {
    storage = new InMemoryAsyncStore()
    manager = createTurnRecoveryManager(storage, scopeKey)
  })

  test('returns false when no pending record exists', async () => {
    const deps = makeReplayDeps()
    const recovered = await attemptStartupRecovery(manager, deps)
    expect(recovered).toBe(false)
    expect(deps.postResponseCalls).toHaveLength(0)
    expect(deps.housekeepingCalls).toHaveLength(0)
  })

  test('replays postResponse + housekeeping for post-response-pending', async () => {
    const postInput = makePostInput()
    await manager.persist(1, postInput)

    const deps = makeReplayDeps()
    const recovered = await attemptStartupRecovery(manager, deps)

    expect(recovered).toBe(true)
    expect(deps.postResponseCalls).toHaveLength(1)
    expect(deps.postResponseCalls[0]!.turnId).toBe('turn-abc')
    expect(deps.housekeepingCalls).toHaveLength(1)

    // Record should be cleared after success
    const record = await manager.load()
    expect(record).toBeNull()
  })

  test('replays only housekeeping for housekeeping-pending', async () => {
    const postInput = makePostInput()
    await manager.persist(1, postInput)
    await manager.advance('turn-abc')

    const deps = makeReplayDeps()
    const recovered = await attemptStartupRecovery(manager, deps)

    expect(recovered).toBe(true)
    // postResponse should NOT be called for housekeeping-pending
    expect(deps.postResponseCalls).toHaveLength(0)
    expect(deps.housekeepingCalls).toHaveLength(1)

    const record = await manager.load()
    expect(record).toBeNull()
  })

  test('does not double-apply canonical updates when recovering housekeeping-pending', async () => {
    const postInput = makePostInput()
    await manager.persist(1, postInput)
    await manager.advance('turn-abc')

    const postResponse = vi.fn()
    const runHousekeeping = vi.fn()
    const deps = makeReplayDeps({ postResponse, runHousekeeping })

    await attemptStartupRecovery(manager, deps)

    // postResponse must NOT be called — it already succeeded in the previous session
    expect(postResponse).not.toHaveBeenCalled()
    // housekeeping should run exactly once
    expect(runHousekeeping).toHaveBeenCalledTimes(1)
  })

  test('leaves record intact when recovery fails', async () => {
    await manager.persist(1, makePostInput())

    const deps = makeReplayDeps({
      async postResponse() {
        throw new Error('network down')
      },
    })

    const recovered = await attemptStartupRecovery(manager, deps)
    expect(recovered).toBe(true)

    // Record should remain for next attempt
    const record = await manager.load()
    expect(record).not.toBeNull()
    expect(record!.stage).toBe('post-response-pending')
    expect(deps.logs.some((l) => l.includes('Recovery failed'))).toBe(true)
  })

  test('leaves record at housekeeping-pending when housekeeping fails after postResponse succeeds', async () => {
    await manager.persist(1, makePostInput())

    const deps = makeReplayDeps({
      async runHousekeeping() {
        throw new Error('extraction broke')
      },
    })

    await attemptStartupRecovery(manager, deps)

    // postResponse succeeded → record should have been advanced to housekeeping-pending
    const record = await manager.load()
    expect(record).not.toBeNull()
    expect(record!.stage).toBe('housekeeping-pending')
  })
})

// ---------------------------------------------------------------------------
// Integration tests – bootstrapPlugin with turn recovery
// ---------------------------------------------------------------------------

describe('bootstrapPlugin turn recovery integration', () => {
  test('finalizeTurn persists pending record before postResponse', async () => {
    const api = createMockRisuaiApi()
    const storage = api.pluginStorage as InMemoryAsyncStore

    // We'll use a recovery manager to inspect what bootstrapPlugin persists
    const recoveryManager = createTurnRecoveryManager(storage, 'default')

    let capturedRecordBeforePostResponse: PendingTurnRecord | null = null

    const postResponse = vi.fn(async () => {
      // Capture the record state at the moment postResponse is called
      capturedRecordBeforePostResponse = await recoveryManager.load()
      return makeUpdate()
    })

    await bootstrapPlugin(api, {
      director: {
        async preRequest() { return { brief: makeBrief() } },
        postResponse,
      },
      turnRecovery: recoveryManager,
    })

    await api.runBeforeRequest([
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Go.' },
    ])
    await api.runAfterRequest('The actor responds.')

    expect(postResponse).toHaveBeenCalledTimes(1)
    expect(capturedRecordBeforePostResponse).not.toBeNull()
    expect(capturedRecordBeforePostResponse!.stage).toBe('post-response-pending')
  })

  test('successful postResponse advances record to housekeeping-pending', async () => {
    const api = createMockRisuaiApi()
    const storage = api.pluginStorage as InMemoryAsyncStore
    const recoveryManager = createTurnRecoveryManager(storage, 'default')

    let recordAfterPostResponse: PendingTurnRecord | null = null

    const onTurnFinalized = vi.fn(async () => {
      // At this point postResponse succeeded, so record should be advanced
      recordAfterPostResponse = await recoveryManager.load()
    })

    await bootstrapPlugin(api, {
      director: {
        async preRequest() { return { brief: makeBrief() } },
        async postResponse() { return makeUpdate() },
      },
      turnRecovery: recoveryManager,
      onTurnFinalized,
    })

    await api.runBeforeRequest([
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Go.' },
    ])
    await api.runAfterRequest('The actor responds.')

    expect(onTurnFinalized).toHaveBeenCalledTimes(1)
    expect(recordAfterPostResponse).not.toBeNull()
    expect(recordAfterPostResponse!.stage).toBe('housekeeping-pending')
  })

  test('successful housekeeping clears the recovery record', async () => {
    const api = createMockRisuaiApi()
    const storage = api.pluginStorage as InMemoryAsyncStore
    const recoveryManager = createTurnRecoveryManager(storage, 'default')

    await bootstrapPlugin(api, {
      director: {
        async preRequest() { return { brief: makeBrief() } },
        async postResponse() { return makeUpdate() },
      },
      turnRecovery: recoveryManager,
      onTurnFinalized: async () => {
        // Simulate successful housekeeping (no throw)
      },
    })

    await api.runBeforeRequest([
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Go.' },
    ])
    await api.runAfterRequest('The actor responds.')

    const record = await recoveryManager.load()
    expect(record).toBeNull()
  })

  test('failed housekeeping leaves record at housekeeping-pending', async () => {
    const api = createMockRisuaiApi()
    const storage = api.pluginStorage as InMemoryAsyncStore
    const recoveryManager = createTurnRecoveryManager(storage, 'default')

    await bootstrapPlugin(api, {
      director: {
        async preRequest() { return { brief: makeBrief() } },
        async postResponse() { return makeUpdate() },
      },
      turnRecovery: recoveryManager,
      onTurnFinalized: async () => {
        throw new Error('Extraction service unavailable')
      },
    })

    await api.runBeforeRequest([
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Go.' },
    ])
    await api.runAfterRequest('The actor responds.')

    const record = await recoveryManager.load()
    expect(record).not.toBeNull()
    expect(record!.stage).toBe('housekeeping-pending')
  })

  test('failed postResponse leaves recovery record intact', async () => {
    const api = createMockRisuaiApi()
    const storage = api.pluginStorage as InMemoryAsyncStore
    const recoveryManager = createTurnRecoveryManager(storage, 'default')

    await bootstrapPlugin(api, {
      director: {
        async preRequest() { return { brief: makeBrief() } },
        async postResponse() { throw new Error('LLM unavailable') },
      },
      turnRecovery: recoveryManager,
    })

    await api.runBeforeRequest([
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Go.' },
    ])
    await api.runAfterRequest('The actor responds.')

    const record = await recoveryManager.load()
    expect(record).not.toBeNull()
    expect(record!.stage).toBe('post-response-pending')
  })
})
