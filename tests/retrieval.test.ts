import { retrieveMemory } from '../src/memory/retrieval.js'
import { createEmptyState } from '../src/contracts/types.js'

describe('retrieveMemory', () => {
  test('promotes continuity locks to mustInject and matching summaries to highPriority', () => {
    const state = createEmptyState()
    state.director.currentSceneId = 'scene-1'
    state.director.continuityFacts.push({
      id: 'c1',
      text: 'Mina still has the letter in her coat.',
      priority: 10,
      sceneId: 'scene-1'
    })
    state.memory.summaries.push({
      id: 's1',
      text: 'Mina argued with Rion about the missing letter.',
      sceneId: 'scene-1',
      recencyWeight: 0.9,
      updatedAt: Date.now(),
      entityIds: ['mina', 'rion']
    })
    state.memory.worldFacts.push({
      id: 'w1',
      text: 'The city curfew starts at midnight.',
      updatedAt: Date.now()
    })

    const result = retrieveMemory({
      state,
      messages: [
        { role: 'assistant', content: 'Rion waits in silence.' },
        { role: 'user', content: 'Mina touches the letter in her coat and steps outside.' }
      ]
    })

    expect(result.mustInject).toContain('Mina still has the letter in her coat.')
    expect(result.highPriority.some((entry) => entry.includes('missing letter'))).toBe(true)
    expect(result.opportunistic.some((entry) => entry.includes('midnight'))).toBe(true)
  })

  test('returns empty buckets for empty state', () => {
    const state = createEmptyState()
    const result = retrieveMemory({ state, messages: [] })

    expect(result.mustInject).toEqual([])
    expect(result.highPriority).toEqual([])
    expect(result.opportunistic).toEqual([])
    expect(result.scores).toEqual({})
  })

  test('scores are deterministic across repeated calls', () => {
    const state = createEmptyState()
    state.director.currentSceneId = 'scene-1'
    state.memory.summaries.push({
      id: 's1',
      text: 'The dragon attacked the village at dawn.',
      sceneId: 'scene-1',
      recencyWeight: 0.7,
      updatedAt: Date.now(),
      entityIds: ['dragon']
    })
    const messages = [{ role: 'user' as const, content: 'The dragon roars.' }]

    const r1 = retrieveMemory({ state, messages })
    const r2 = retrieveMemory({ state, messages })

    expect(r1.scores['s1']).toBe(r2.scores['s1'])
    expect(r1.highPriority).toEqual(r2.highPriority)
  })

  test('continuity facts without matching scene still appear in mustInject', () => {
    const state = createEmptyState()
    state.director.currentSceneId = 'scene-2'
    state.director.continuityFacts.push({
      id: 'c1',
      text: 'The protagonist lost an arm.',
      priority: 5
    })

    const result = retrieveMemory({ state, messages: [] })

    expect(result.mustInject).toContain('The protagonist lost an arm.')
    expect(result.scores['c1']).toBe(1.0)
  })

  test('world fact with matching entities ranks into highPriority', () => {
    const state = createEmptyState()
    state.director.currentSceneId = 'scene-1'
    state.memory.worldFacts.push({
      id: 'w1',
      text: 'Elena controls the eastern trade routes.',
      tags: ['elena', 'trade'],
      updatedAt: Date.now()
    })
    state.memory.summaries.push({
      id: 's1',
      text: 'Elena negotiated a deal for the eastern trade routes with the guild.',
      sceneId: 'scene-1',
      recencyWeight: 0.8,
      updatedAt: Date.now(),
      entityIds: ['elena']
    })

    const result = retrieveMemory({
      state,
      messages: [{ role: 'user', content: 'Elena walks into the guild hall.' }]
    })

    // Summary matches scene + entity + text → highPriority
    expect(result.highPriority.some((e) => e.includes('Elena negotiated'))).toBe(true)
    expect(result.scores['s1']).toBeGreaterThan(result.scores['w1']!)
  })
})
