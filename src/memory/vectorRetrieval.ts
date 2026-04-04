/**
 * Vector similarity utilities for embedding-based prefiltering.
 *
 * Provides cosine similarity computation and a bounded candidate
 * prefilter that ranks memdir documents by vector proximity to a
 * query embedding. Used as an optional upstream filter before the
 * recall-model selection step.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RESULTS = 10
const DEFAULT_MIN_SIMILARITY = 0

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VectorCandidate {
  id: string
  vector: number[]
}

export interface VectorPrefilterResult {
  id: string
  similarity: number
}

export interface VectorPrefilterOptions {
  maxResults?: number
  minSimilarity?: number
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

/**
 * Compute cosine similarity between two vectors.
 * Returns 0 for zero-length or mismatched-dimension vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0

  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (denom === 0) return 0

  return dot / denom
}

// ---------------------------------------------------------------------------
// Vector prefilter
// ---------------------------------------------------------------------------

/**
 * Rank candidates by cosine similarity to the query vector and return
 * the top results above the minimum similarity threshold.
 *
 * This is a bounded prefilter — it narrows the candidate set but
 * never blocks the keyword fallback path.
 */
export function vectorPrefilter(
  candidates: VectorCandidate[],
  queryVector: number[],
  options?: VectorPrefilterOptions,
): VectorPrefilterResult[] {
  const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS
  const minSimilarity = options?.minSimilarity ?? DEFAULT_MIN_SIMILARITY

  const scored: VectorPrefilterResult[] = []

  for (const candidate of candidates) {
    const similarity = cosineSimilarity(candidate.vector, queryVector)
    if (similarity > minSimilarity) {
      scored.push({ id: candidate.id, similarity })
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, maxResults)
}
