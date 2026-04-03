import { describe, expect, test, beforeEach } from 'vitest'
import {
  SessionNotebook,
  type NotebookSection,
  type SessionNotebookOptions,
  NOTEBOOK_SECTIONS,
  DEFAULT_NOTEBOOK_THRESHOLDS,
  formatNotebookBlock,
} from '../src/memory/sessionMemory.js'
import { buildPreRequestPrompt, type DirectorContext } from '../src/director/prompt.js'
import { createEmptyState } from '../src/contracts/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDirectorContext(overrides?: Partial<DirectorContext>): DirectorContext {
  const state = createEmptyState()
  return {
    messages: [
      { role: 'system', content: 'You are a character in a story.' },
      { role: 'user', content: 'Message 1' },
      { role: 'assistant', content: 'Message 2' },
    ],
    directorState: state.director,
    memory: state.memory,
    assertiveness: 'standard',
    briefTokenCap: 320,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. Initialising a scoped session notebook
// ---------------------------------------------------------------------------

describe('SessionNotebook – initialisation', () => {
  test('creates a notebook scoped to a given key', () => {
    const nb = new SessionNotebook('scope-abc')
    expect(nb.scopeKey).toBe('scope-abc')
  })

  test('all canonical sections start empty', () => {
    const nb = new SessionNotebook('s1')
    const snap = nb.snapshot()
    for (const section of NOTEBOOK_SECTIONS) {
      expect(snap[section]).toBe('')
    }
  })

  test('snapshot returns a frozen copy', () => {
    const nb = new SessionNotebook('s1')
    const snap1 = nb.snapshot()
    // Object.freeze prevents mutation — verify the snapshot is frozen
    expect(Object.isFrozen(snap1)).toBe(true)
    // A new snapshot should be an independent copy
    nb.forceUpdate({ currentState: 'changed' })
    expect(snap1.currentState).toBe('')
    expect(nb.snapshot().currentState).toBe('changed')
  })

  test('turnsSinceUpdate starts at zero', () => {
    const nb = new SessionNotebook('s1')
    expect(nb.turnsSinceUpdate).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 2. Threshold-gated updates
// ---------------------------------------------------------------------------

describe('SessionNotebook – threshold-gated updates', () => {
  let nb: SessionNotebook

  beforeEach(() => {
    nb = new SessionNotebook('s1', { turnThreshold: 3, tokenThreshold: 500 })
  })

  test('update is rejected when below turn threshold', () => {
    nb.recordTurn(100)
    nb.recordTurn(100)
    // 2 turns, threshold is 3
    const accepted = nb.tryUpdate({ currentState: 'some state' })
    expect(accepted).toBe(false)
    expect(nb.snapshot().currentState).toBe('')
  })

  test('update is accepted once turn threshold is reached', () => {
    nb.recordTurn(100)
    nb.recordTurn(100)
    nb.recordTurn(100)
    const accepted = nb.tryUpdate({ currentState: 'some state' })
    expect(accepted).toBe(true)
    expect(nb.snapshot().currentState).toBe('some state')
  })

  test('update accepted early when token threshold is exceeded', () => {
    // Only 1 turn but lots of tokens
    nb.recordTurn(600)
    const accepted = nb.tryUpdate({ currentState: 'big state' })
    expect(accepted).toBe(true)
    expect(nb.snapshot().currentState).toBe('big state')
  })

  test('counters reset after a successful update', () => {
    nb.recordTurn(100)
    nb.recordTurn(100)
    nb.recordTurn(100)
    nb.tryUpdate({ currentState: 'v1' })

    // counters should be 0 again
    expect(nb.turnsSinceUpdate).toBe(0)

    // immediate update should be rejected (below threshold)
    const accepted = nb.tryUpdate({ currentState: 'v2' })
    expect(accepted).toBe(false)
    expect(nb.snapshot().currentState).toBe('v1')
  })

  test('partial section updates merge without overwriting unset sections', () => {
    nb.recordTurn(100)
    nb.recordTurn(100)
    nb.recordTurn(100)
    nb.tryUpdate({
      currentState: 'state A',
      immediateGoals: 'goals A',
    })

    // accumulate turns again
    nb.recordTurn(100)
    nb.recordTurn(100)
    nb.recordTurn(100)
    nb.tryUpdate({
      currentState: 'state B',
    })

    const snap = nb.snapshot()
    expect(snap.currentState).toBe('state B')
    expect(snap.immediateGoals).toBe('goals A') // preserved
  })

  test('forceUpdate bypasses thresholds', () => {
    nb.forceUpdate({ currentState: 'forced' })
    expect(nb.snapshot().currentState).toBe('forced')
  })

  test('default thresholds are sensible', () => {
    expect(DEFAULT_NOTEBOOK_THRESHOLDS.turnThreshold).toBeGreaterThanOrEqual(2)
    expect(DEFAULT_NOTEBOOK_THRESHOLDS.tokenThreshold).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 3. Notebook projection into Director prompt assembly
// ---------------------------------------------------------------------------

describe('notebook projection into prompt assembly', () => {
  test('formatNotebookBlock returns empty string for empty notebook', () => {
    const nb = new SessionNotebook('s1')
    expect(formatNotebookBlock(nb.snapshot())).toBe('')
  })

  test('formatNotebookBlock renders populated sections', () => {
    const nb = new SessionNotebook('s1')
    nb.forceUpdate({
      currentState: 'In the castle courtyard.',
      immediateGoals: 'Find the hidden door.',
      recentMistakes: 'Repeated a scene description.',
    })
    const block = formatNotebookBlock(nb.snapshot())

    expect(block).toContain('In the castle courtyard.')
    expect(block).toContain('Find the hidden door.')
    expect(block).toContain('Repeated a scene description.')
    // Empty sections should not appear
    expect(block).not.toContain('Important Recent Developments')
    expect(block).not.toContain('Unresolved Threads')
  })

  test('notebook block appears before memory summaries in pre-request prompt', () => {
    const nb = new SessionNotebook('s1')
    nb.forceUpdate({ currentState: 'In the dark forest.' })
    const block = formatNotebookBlock(nb.snapshot())

    const ctx = makeDirectorContext({
      notebookBlock: block,
    } as Partial<DirectorContext>)

    const msgs = buildPreRequestPrompt(ctx)
    const userContent = msgs.find((m) => m.role === 'user')?.content ?? ''

    const notebookIdx = userContent.indexOf('In the dark forest.')
    const memoryIdx = userContent.indexOf('## Memory Summaries')
    expect(notebookIdx).toBeGreaterThan(-1)
    expect(memoryIdx).toBeGreaterThan(-1)
    expect(notebookIdx).toBeLessThan(memoryIdx)
  })

  test('prompt assembly works normally when notebookBlock is absent', () => {
    const ctx = makeDirectorContext()
    const msgs = buildPreRequestPrompt(ctx)
    const userContent = msgs.find((m) => m.role === 'user')?.content ?? ''
    expect(userContent).toContain('## Memory Summaries')
    // No notebook header when block is empty/missing
    expect(userContent).not.toContain('## Session Notebook')
  })
})

// ---------------------------------------------------------------------------
// 4. TurnCache integration – finalized turn count tracking
// ---------------------------------------------------------------------------

describe('TurnCache – notebook turn tracking', () => {
  test('recordTurn accumulates token estimates', () => {
    const nb = new SessionNotebook('s1', { turnThreshold: 2, tokenThreshold: 9999 })
    nb.recordTurn(150)
    nb.recordTurn(200)
    expect(nb.turnsSinceUpdate).toBe(2)
    expect(nb.tokensSinceUpdate).toBe(350)
  })
})
