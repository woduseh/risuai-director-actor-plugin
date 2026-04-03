/**
 * Tests that applyMemoryUpdate mirrors continuity facts into both
 * state.director.continuityFacts and state.memory.continuityFacts.
 *
 * Currently applyUpdate.ts only writes to director.continuityFacts,
 * so the memory.continuityFacts assertions will fail (assertion-red).
 */
import { applyMemoryUpdate } from '../src/memory/applyUpdate.js'
import { createEmptyState } from '../src/contracts/types.js'
import type { MemoryUpdate, SceneBrief } from '../src/contracts/types.js'
import type { ApplyMemoryUpdateInput } from '../src/memory/applyUpdate.js'

function createMinimalBrief(overrides?: Partial<SceneBrief>): SceneBrief {
  return {
    confidence: 0.9,
    pacing: 'steady',
    beats: [],
    continuityLocks: [],
    ensembleWeights: {},
    styleInheritance: {},
    forbiddenMoves: [],
    memoryHints: [],
    ...overrides
  }
}

function createMinimalInput(overrides?: Partial<ApplyMemoryUpdateInput>): ApplyMemoryUpdateInput {
  return {
    turnId: 'turn-test-1',
    userText: 'test user',
    actorText: 'test actor',
    brief: createMinimalBrief(overrides?.brief as Partial<SceneBrief>),
    ...overrides
  }
}

function createMinimalUpdate(overrides?: Partial<MemoryUpdate>): MemoryUpdate {
  return {
    status: 'pass',
    turnScore: 0.9,
    violations: [],
    durableFacts: [],
    sceneDelta: {},
    entityUpdates: [],
    relationUpdates: [],
    memoryOps: [],
    ...overrides
  }
}

describe('applyMemoryUpdate — continuity mirroring', () => {
  test('memoryOps insert of a continuity fact appears in both director and memory', () => {
    const state = createEmptyState()
    const update = createMinimalUpdate({
      memoryOps: [
        {
          op: 'insert',
          target: 'continuityFact',
          payload: { text: 'The bridge collapsed', priority: 0.8 }
        }
      ]
    })
    const input = createMinimalInput()

    const { state: result } = applyMemoryUpdate(state, update, input)

    expect(result.director.continuityFacts).toContainEqual(
      expect.objectContaining({ text: 'The bridge collapsed' })
    )
    expect(result.memory.continuityFacts).toContainEqual(
      expect.objectContaining({ text: 'The bridge collapsed' })
    )
  })

  test('continuityLocks from brief appear in both director and memory', () => {
    const state = createEmptyState()
    const update = createMinimalUpdate()
    const input = createMinimalInput({
      brief: createMinimalBrief({
        continuityLocks: ['The queen is alive']
      })
    })

    const { state: result } = applyMemoryUpdate(state, update, input)

    expect(result.director.continuityFacts).toContainEqual(
      expect.objectContaining({ text: 'The queen is alive' })
    )
    expect(result.memory.continuityFacts).toContainEqual(
      expect.objectContaining({ text: 'The queen is alive' })
    )
  })

  test('memoryOps drop of a continuity fact removes from both director and memory', () => {
    const state = createEmptyState()
    const fact = { id: 'cf-drop', text: 'Obsolete fact', priority: 0.5 }
    state.director.continuityFacts.push({ ...fact })
    state.memory.continuityFacts.push({ ...fact })

    const update = createMinimalUpdate({
      memoryOps: [
        {
          op: 'drop',
          target: 'continuityFact',
          payload: { id: 'cf-drop' }
        }
      ]
    })
    const input = createMinimalInput()

    const { state: result } = applyMemoryUpdate(state, update, input)

    expect(result.director.continuityFacts.find((f) => f.id === 'cf-drop')).toBeUndefined()
    expect(result.memory.continuityFacts.find((f) => f.id === 'cf-drop')).toBeUndefined()
  })

  test('repeated continuityLocks reuse the existing fact instead of duplicating by text', () => {
    const state = createEmptyState()
    const update = createMinimalUpdate()
    const input = createMinimalInput({
      brief: createMinimalBrief({
        continuityLocks: ['The relic remains sealed']
      })
    })

    const first = applyMemoryUpdate(state, update, input).state
    const second = applyMemoryUpdate(first, update, input).state

    expect(second.director.continuityFacts).toHaveLength(1)
    expect(second.memory.continuityFacts).toHaveLength(1)
    expect(second.director.continuityFacts[0]?.text).toBe('The relic remains sealed')
    expect(second.memory.continuityFacts[0]?.text).toBe('The relic remains sealed')
  })
})
