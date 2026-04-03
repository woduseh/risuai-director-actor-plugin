import { retrieveMemory, rankDocsByKeywordOverlap } from '../src/memory/retrieval.js'
import { createEmptyState } from '../src/contracts/types.js'
import type { MemdirDocument } from '../src/contracts/types.js'

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

// ---------------------------------------------------------------------------
// rankDocsByKeywordOverlap — deterministic fallback for memdir docs
// ---------------------------------------------------------------------------

function makeDoc(overrides?: Partial<MemdirDocument>): MemdirDocument {
  return {
    id: 'doc-1',
    type: 'character',
    title: 'Default',
    description: 'Default description',
    scopeKey: 'scope',
    updatedAt: Date.now(),
    source: 'extraction',
    freshness: 'current',
    tags: [],
    ...overrides,
  }
}

describe('rankDocsByKeywordOverlap', () => {
  test('ranks docs by keyword overlap with query text', () => {
    const docs = [
      makeDoc({ id: 'd1', title: 'Dragon Lore', description: 'The dragon attacked at dawn', tags: ['dragon'] }),
      makeDoc({ id: 'd2', title: 'Market Trade', description: 'Trading goods at the market', tags: ['trade'] }),
      makeDoc({ id: 'd3', title: 'Dragon Rider', description: 'The dragon rider soared above', tags: ['dragon', 'rider'] }),
    ]

    const result = rankDocsByKeywordOverlap(docs, 'The dragon breathed fire', 5)

    // Dragon-related docs should rank first
    expect(result[0]!.id).toMatch(/d[13]/)
    expect(result.map(d => d.id)).toContain('d1')
    expect(result.map(d => d.id)).toContain('d3')
  })

  test('respects maxResults limit', () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      makeDoc({ id: `d${i}`, title: `Doc ${i}`, description: `content ${i}` }),
    )

    const result = rankDocsByKeywordOverlap(docs, 'content query', 3)
    expect(result.length).toBeLessThanOrEqual(3)
  })

  test('returns empty array for empty doc list', () => {
    const result = rankDocsByKeywordOverlap([], 'query', 5)
    expect(result).toEqual([])
  })

  test('returns docs when query has no significant tokens', () => {
    const docs = [makeDoc({ id: 'd1' })]
    const result = rankDocsByKeywordOverlap(docs, 'the is a', 5)
    expect(result.length).toBeLessThanOrEqual(5)
  })
})
