import { describe, test, expect } from 'vitest'
import {
  cosineSimilarity,
  vectorPrefilter,
  type VectorCandidate,
} from '../src/memory/vectorRetrieval.js'

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
  test('identical vectors return 1', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0)
  })

  test('orthogonal vectors return 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0)
  })

  test('opposite vectors return -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0)
  })

  test('similar vectors return high positive value', () => {
    const sim = cosineSimilarity([1, 1, 0], [1, 1, 1])
    expect(sim).toBeGreaterThan(0.5)
    expect(sim).toBeLessThan(1.0)
  })

  test('zero-length vector returns 0', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 0, 0])).toBe(0)
  })

  test('mismatched lengths return 0', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// vectorPrefilter
// ---------------------------------------------------------------------------

describe('vectorPrefilter', () => {
  function makeCandidate(id: string, vector: number[]): VectorCandidate {
    return { id, vector }
  }

  test('returns candidates sorted by descending similarity', () => {
    const query = [1, 0, 0]
    const candidates: VectorCandidate[] = [
      makeCandidate('low', [0.1, 1, 0]),
      makeCandidate('high', [1, 0, 0]),
      makeCandidate('mid', [0.7, 0.7, 0]),
    ]

    const result = vectorPrefilter(candidates, query)
    expect(result.map((r) => r.id)).toEqual(['high', 'mid', 'low'])
  })

  test('respects maxResults limit', () => {
    const query = [1, 0]
    const candidates: VectorCandidate[] = [
      makeCandidate('a', [1, 0]),
      makeCandidate('b', [0.9, 0.1]),
      makeCandidate('c', [0.5, 0.5]),
      makeCandidate('d', [0, 1]),
    ]

    const result = vectorPrefilter(candidates, query, { maxResults: 2 })
    expect(result).toHaveLength(2)
    expect(result[0]!.id).toBe('a')
  })

  test('filters below similarity threshold', () => {
    const query = [1, 0]
    const candidates: VectorCandidate[] = [
      makeCandidate('high', [1, 0]),
      makeCandidate('low', [0, 1]),
    ]

    const result = vectorPrefilter(candidates, query, { minSimilarity: 0.5 })
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('high')
  })

  test('returns empty array for empty candidates', () => {
    const result = vectorPrefilter([], [1, 0])
    expect(result).toEqual([])
  })

  test('returns empty array for zero query vector', () => {
    const candidates: VectorCandidate[] = [
      makeCandidate('a', [1, 0]),
    ]
    const result = vectorPrefilter(candidates, [0, 0])
    expect(result).toEqual([])
  })

  test('includes similarity scores in results', () => {
    const query = [1, 0]
    const candidates: VectorCandidate[] = [
      makeCandidate('a', [1, 0]),
    ]

    const result = vectorPrefilter(candidates, query)
    expect(result[0]!.similarity).toBeCloseTo(1.0)
  })

  test('default maxResults is 10', () => {
    const query = [1, 0]
    const candidates: VectorCandidate[] = Array.from({ length: 20 }, (_, i) =>
      makeCandidate(`doc-${i}`, [1, 0]),
    )

    const result = vectorPrefilter(candidates, query)
    expect(result).toHaveLength(10)
  })
})
