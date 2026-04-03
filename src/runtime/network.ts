/**
 * Lightweight network / hashing utilities for the extraction pipeline.
 *
 * Provides a fast, deterministic content hash for duplicate-request
 * detection without requiring crypto dependencies.
 */

import type { ExtractionContext } from '../memory/extractMemories.js'

// ---------------------------------------------------------------------------
// FNV-1a 32-bit hash (fast, deterministic, no crypto dependency)
// ---------------------------------------------------------------------------

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

/**
 * Compute a fast FNV-1a 32-bit hash of the given string.
 * Returns a hex-encoded string.
 */
export function fnv1aHash(input: string): string {
  let hash = FNV_OFFSET
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Build a deterministic hash key for an extraction context.
 * Uses turnId + content prefix + message count to avoid collisions
 * while keeping computation fast.
 */
export function hashExtractionContext(ctx: ExtractionContext): string {
  const contentPrefix = ctx.content.slice(0, 200)
  const raw = `${ctx.turnId}|${ctx.type}|${ctx.messages.length}|${contentPrefix}`
  return fnv1aHash(raw)
}
