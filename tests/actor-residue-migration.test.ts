import {
  CanonicalStore,
  DIRECTOR_STATE_STORAGE_KEY,
  normalizeActorResidue,
  isValidState,
} from '../src/memory/canonicalStore.js'
import { createEmptyState } from '../src/contracts/types.js'
import { createMockRisuaiApi } from './helpers/mockRisuai.js'
import { InMemoryAsyncStore } from './helpers/mockRisuai.js'

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build a state blob that looks exactly like what was persisted under the
 * continuity-director namespace *before* the actor→character rename
 * (i.e. `.actor` instead of `.character`, `actorText` in sceneLedger).
 */
function makePreRenameBlob(): Record<string, unknown> {
  const base = createEmptyState({ projectKey: 'pre-rename-proj' })
  const blob = structuredClone(base) as unknown as Record<string, unknown>

  // Simulate old property: .actor instead of .character
  blob.actor = blob.character
  delete blob.character

  // Simulate old sceneLedger entries with actorText
  const mem = blob.memory as Record<string, unknown>
  mem.sceneLedger = [
    {
      id: 'ledger-1',
      sceneId: 'scene-0',
      userText: 'Hello there',
      actorText: 'Greetings, traveler.',
      createdAt: 1700000000000,
    },
    {
      id: 'ledger-2',
      sceneId: 'scene-0',
      userText: 'What now?',
      actorText: 'We press on.',
      createdAt: 1700000001000,
    },
  ]

  return blob
}

// ── Unit tests: normalizeActorResidue ────────────────────────────────────

describe('normalizeActorResidue', () => {
  test('renames .actor to .character', () => {
    const blob = makePreRenameBlob()
    expect(blob.actor).toBeDefined()
    expect(blob.character).toBeUndefined()

    const patched = normalizeActorResidue(blob)

    expect(patched).toBe(true)
    expect(blob.character).toBeDefined()
    expect(blob.actor).toBeUndefined()
  })

  test('renames sceneLedger[].actorText to .responseText', () => {
    const blob = makePreRenameBlob()
    const ledger = (blob.memory as Record<string, unknown>).sceneLedger as Record<string, unknown>[]
    expect(ledger[0]!.actorText).toBe('Greetings, traveler.')
    expect(ledger[0]!.responseText).toBeUndefined()

    normalizeActorResidue(blob)

    expect(ledger[0]!.responseText).toBe('Greetings, traveler.')
    expect(ledger[0]!.actorText).toBeUndefined()
    expect(ledger[1]!.responseText).toBe('We press on.')
    expect(ledger[1]!.actorText).toBeUndefined()
  })

  test('is a no-op when blob already uses current property names', () => {
    const blob = structuredClone(createEmptyState()) as unknown as Record<string, unknown>
    const patched = normalizeActorResidue(blob)

    expect(patched).toBe(false)
    expect(blob.character).toBeDefined()
  })

  test('does not overwrite existing .character with .actor', () => {
    const blob = makePreRenameBlob()
    // Manually set .character so both exist
    blob.character = { identityAnchor: ['override'] }

    normalizeActorResidue(blob)

    // .actor is kept (guard: character already exists)
    expect((blob.character as Record<string, unknown>).identityAnchor).toEqual(['override'])
  })

  test('does not overwrite existing .responseText with .actorText', () => {
    const blob = makePreRenameBlob()
    const ledger = (blob.memory as Record<string, unknown>).sceneLedger as Record<string, unknown>[]
    // Simulate an entry that already has responseText
    ledger[0]!.responseText = 'already-migrated'

    normalizeActorResidue(blob)

    expect(ledger[0]!.responseText).toBe('already-migrated')
  })

  test('handles blob with no memory or empty sceneLedger gracefully', () => {
    const blob: Record<string, unknown> = { actor: { identityAnchor: [] } }
    const patched = normalizeActorResidue(blob)
    expect(patched).toBe(true)
    expect(blob.character).toBeDefined()

    const blob2: Record<string, unknown> = {
      actor: {},
      memory: { sceneLedger: [] },
    }
    normalizeActorResidue(blob2)
    expect(blob2.character).toBeDefined()
  })
})

// ── Integration: pre-rename blob through CanonicalStore.load() ──────────

describe('CanonicalStore loads pre-rename actor blobs', () => {
  test('load() normalizes .actor → .character and does not fall back to empty state', async () => {
    const api = createMockRisuaiApi()
    const blob = makePreRenameBlob()

    // Persist the pre-rename blob under the current namespace key
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, blob)

    const store = new CanonicalStore(api.pluginStorage)
    const state = await store.load()

    // Must NOT be the default empty state
    expect(state.projectKey).toBe('pre-rename-proj')
    // .character must be populated
    expect(state.character).toBeDefined()
    expect(state.character.identityAnchor).toEqual([])
  })

  test('load() normalizes sceneLedger actorText → responseText', async () => {
    const api = createMockRisuaiApi()
    const blob = makePreRenameBlob()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, blob)

    const store = new CanonicalStore(api.pluginStorage)
    const state = await store.load()

    expect(state.memory.sceneLedger).toHaveLength(2)
    expect(state.memory.sceneLedger[0]!.responseText).toBe('Greetings, traveler.')
    expect(state.memory.sceneLedger[1]!.responseText).toBe('We press on.')
    // Old property must not leak through
    expect((state.memory.sceneLedger[0] as unknown as Record<string, unknown>).actorText).toBeUndefined()
  })

  test('load() normalizes pre-rename blob via flat-key migration path', async () => {
    const storage = new InMemoryAsyncStore()
    const scopedKey = 'continuity-director-state::scope:actor-mig:test'
    const blob = makePreRenameBlob()

    // Pre-rename blob exists only under the flat key
    await storage.setItem(DIRECTOR_STATE_STORAGE_KEY, blob)

    const store = new CanonicalStore(storage, {
      storageKey: scopedKey,
      migrateFromFlatKey: true,
    })
    const state = await store.load()

    expect(state.projectKey).toBe('pre-rename-proj')
    expect(state.character).toBeDefined()
    expect(state.memory.sceneLedger[0]!.responseText).toBe('Greetings, traveler.')
  })

  test('isValidState accepts blob after normalizeActorResidue', () => {
    const blob = makePreRenameBlob()

    // Before normalization: isValidState rejects (no .character)
    expect(isValidState(blob)).toBe(false)

    normalizeActorResidue(blob)

    // After normalization: isValidState accepts
    expect(isValidState(blob)).toBe(true)
  })

  test('snapshot() after loading pre-rename blob returns normalized state', async () => {
    const api = createMockRisuaiApi()
    const blob = makePreRenameBlob()
    await api.pluginStorage.setItem(DIRECTOR_STATE_STORAGE_KEY, blob)

    const store = new CanonicalStore(api.pluginStorage)
    await store.load()

    const snap = store.snapshot()
    expect(snap.character).toBeDefined()
    expect(snap.memory.sceneLedger[0]!.responseText).toBe('Greetings, traveler.')
  })
})
