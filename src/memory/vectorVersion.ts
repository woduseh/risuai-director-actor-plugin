/**
 * Vector version fingerprint.
 *
 * Computes a stable, deterministic version string from embedding
 * configuration settings. Used to detect when stored vectors are
 * stale (i.e. the embedding settings changed since vectors were
 * computed).
 */

import { fnv1aHash } from '../runtime/network.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VectorVersionInput {
  provider: string
  baseUrl: string
  model: string
  dimensions: number
}

// ---------------------------------------------------------------------------
// Version computation
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic version fingerprint from embedding settings.
 *
 * The fingerprint changes whenever any of the four canonical fields
 * change, which invalidates all previously stored vectors.
 */
export function computeVectorVersion(input: VectorVersionInput): string {
  const normalizedUrl = input.baseUrl.replace(/\/+$/, '')
  const raw = [
    input.provider,
    normalizedUrl,
    input.model,
    String(input.dimensions),
  ].join('|')
  return `emb-${fnv1aHash(raw)}`
}
