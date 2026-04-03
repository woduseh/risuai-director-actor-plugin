/**
 * Tests for typed memory mutation helpers (memoryMutations.ts).
 *
 * These helpers do not exist yet — the import below will fail at
 * compile time until the module is created. Each test documents the
 * expected contract for one mutation helper.
 */
import { createEmptyState } from '../src/contracts/types.js'
import type { DirectorPluginState } from '../src/contracts/types.js'
import {
  upsertSummary,
  deleteSummary,
  upsertWorldFact,
  deleteWorldFact,
  upsertEntity,
  deleteEntity,
  upsertRelation,
  deleteRelation,
  upsertContinuityFact,
  deleteContinuityFact
} from '../src/memory/memoryMutations.js'

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------
describe('memory mutation helpers — summaries', () => {
  test('upsertSummary inserts a new summary into state.memory.summaries', () => {
    const state = createEmptyState()

    upsertSummary(state, { text: 'The hero entered the dungeon', recencyWeight: 1 })

    expect(state.memory.summaries).toHaveLength(1)
    expect(state.memory.summaries[0]).toEqual(
      expect.objectContaining({ text: 'The hero entered the dungeon', recencyWeight: 1 })
    )
    expect(state.memory.summaries[0]!.id).toBeTruthy()
    expect(state.memory.summaries[0]!.updatedAt).toBeGreaterThan(0)
  })

  test('upsertSummary updates an existing summary matched by id', () => {
    const state = createEmptyState()
    state.memory.summaries.push({
      id: 'sum-1',
      text: 'Old text',
      recencyWeight: 1,
      updatedAt: 1
    })

    upsertSummary(state, { id: 'sum-1', text: 'Updated text', recencyWeight: 2 })

    expect(state.memory.summaries).toHaveLength(1)
    expect(state.memory.summaries[0]!.text).toBe('Updated text')
    expect(state.memory.summaries[0]!.recencyWeight).toBe(2)
  })

  test('deleteSummary removes a summary by id', () => {
    const state = createEmptyState()
    state.memory.summaries.push({
      id: 'sum-1',
      text: 'To be removed',
      recencyWeight: 1,
      updatedAt: 1
    })

    const removed = deleteSummary(state, 'sum-1')

    expect(removed).toBe(true)
    expect(state.memory.summaries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// World Facts
// ---------------------------------------------------------------------------
describe('memory mutation helpers — world facts', () => {
  test('upsertWorldFact inserts a new world fact', () => {
    const state = createEmptyState()

    upsertWorldFact(state, { text: 'Magic is forbidden in the kingdom' })

    expect(state.memory.worldFacts).toHaveLength(1)
    expect(state.memory.worldFacts[0]).toEqual(
      expect.objectContaining({ text: 'Magic is forbidden in the kingdom' })
    )
  })

  test('upsertWorldFact updates an existing world fact matched by id', () => {
    const state = createEmptyState()
    state.memory.worldFacts.push({
      id: 'wf-1',
      text: 'Old rule',
      updatedAt: 1
    })

    upsertWorldFact(state, { id: 'wf-1', text: 'Updated rule', tags: ['politics'] })

    expect(state.memory.worldFacts).toHaveLength(1)
    expect(state.memory.worldFacts[0]!.text).toBe('Updated rule')
  })

  test('deleteWorldFact removes a world fact by id', () => {
    const state = createEmptyState()
    state.memory.worldFacts.push({ id: 'wf-1', text: 'Gone', updatedAt: 1 })

    const removed = deleteWorldFact(state, 'wf-1')

    expect(removed).toBe(true)
    expect(state.memory.worldFacts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
describe('memory mutation helpers — entities', () => {
  test('upsertEntity inserts a new entity', () => {
    const state = createEmptyState()

    upsertEntity(state, { name: 'Aria', facts: ['Is a mage'], tags: ['protagonist'] })

    expect(state.memory.entities).toHaveLength(1)
    expect(state.memory.entities[0]).toEqual(
      expect.objectContaining({ name: 'Aria', facts: ['Is a mage'] })
    )
  })

  test('upsertEntity updates an existing entity matched by id', () => {
    const state = createEmptyState()
    state.memory.entities.push({
      id: 'ent-1',
      name: 'Aria',
      facts: ['Is a mage'],
      updatedAt: 1
    })

    upsertEntity(state, { id: 'ent-1', facts: ['Is a mage', 'Knows fire magic'] })

    expect(state.memory.entities).toHaveLength(1)
    expect(state.memory.entities[0]!.facts).toContain('Knows fire magic')
  })

  test('deleteEntity removes an entity by id', () => {
    const state = createEmptyState()
    state.memory.entities.push({
      id: 'ent-1',
      name: 'Aria',
      facts: [],
      updatedAt: 1
    })

    const removed = deleteEntity(state, 'ent-1')

    expect(removed).toBe(true)
    expect(state.memory.entities).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
describe('memory mutation helpers — relations', () => {
  test('upsertRelation inserts a new relation', () => {
    const state = createEmptyState()

    upsertRelation(state, {
      sourceId: 'ent-1',
      targetId: 'ent-2',
      label: 'rivals',
      facts: ['Competed for the throne']
    })

    expect(state.memory.relations).toHaveLength(1)
    expect(state.memory.relations[0]).toEqual(
      expect.objectContaining({ sourceId: 'ent-1', targetId: 'ent-2', label: 'rivals' })
    )
  })

  test('upsertRelation updates an existing relation matched by id', () => {
    const state = createEmptyState()
    state.memory.relations.push({
      id: 'rel-1',
      sourceId: 'ent-1',
      targetId: 'ent-2',
      label: 'allies',
      facts: [],
      updatedAt: 1
    })

    upsertRelation(state, { id: 'rel-1', facts: ['Fought together at the pass'] })

    expect(state.memory.relations).toHaveLength(1)
    expect(state.memory.relations[0]!.facts).toContain('Fought together at the pass')
  })

  test('deleteRelation removes a relation by id', () => {
    const state = createEmptyState()
    state.memory.relations.push({
      id: 'rel-1',
      sourceId: 'ent-1',
      targetId: 'ent-2',
      label: 'allies',
      updatedAt: 1
    })

    const removed = deleteRelation(state, 'rel-1')

    expect(removed).toBe(true)
    expect(state.memory.relations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Continuity Facts — dual-sync requirement
// ---------------------------------------------------------------------------
describe('memory mutation helpers — continuity facts (dual sync)', () => {
  test('upsertContinuityFact inserts into both memory.continuityFacts and director.continuityFacts', () => {
    const state = createEmptyState()

    upsertContinuityFact(state, { text: 'The bridge was destroyed', priority: 0.9 })

    expect(state.memory.continuityFacts).toHaveLength(1)
    expect(state.director.continuityFacts).toHaveLength(1)

    const memFact = state.memory.continuityFacts[0]!
    const dirFact = state.director.continuityFacts[0]!
    expect(memFact.text).toBe('The bridge was destroyed')
    expect(dirFact.text).toBe('The bridge was destroyed')
    expect(memFact.id).toBe(dirFact.id)
  })

  test('upsertContinuityFact updates both locations when matched by id', () => {
    const state = createEmptyState()
    const fact = { id: 'cf-1', text: 'Old fact', priority: 0.5 }
    state.memory.continuityFacts.push({ ...fact })
    state.director.continuityFacts.push({ ...fact })

    upsertContinuityFact(state, { id: 'cf-1', text: 'Updated fact', priority: 0.8 })

    expect(state.memory.continuityFacts).toHaveLength(1)
    expect(state.director.continuityFacts).toHaveLength(1)
    expect(state.memory.continuityFacts[0]!.text).toBe('Updated fact')
    expect(state.director.continuityFacts[0]!.text).toBe('Updated fact')
  })

  test('deleteContinuityFact removes from both memory and director', () => {
    const state = createEmptyState()
    const fact = { id: 'cf-1', text: 'To remove', priority: 0.5 }
    state.memory.continuityFacts.push({ ...fact })
    state.director.continuityFacts.push({ ...fact })

    const removed = deleteContinuityFact(state, 'cf-1')

    expect(removed).toBe(true)
    expect(state.memory.continuityFacts).toHaveLength(0)
    expect(state.director.continuityFacts).toHaveLength(0)
  })
})
