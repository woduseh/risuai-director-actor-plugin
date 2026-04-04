/**
 * Embedding integration helpers.
 *
 * Connects the embedding client, vector version, and memdir store
 * to support:
 *  - embedding newly persisted documents
 *  - refreshing embeddings for all documents in a scope
 *  - computing embedding cache status for dashboard reporting
 */

import type { MemdirDocument, EmbeddingCacheStatus } from '../contracts/types.js'
import type { EmbeddingClient } from './embeddingClient.js'
import type { MemdirStore } from './memdirStore.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbedDocumentsInput {
  memdirStore: MemdirStore
  embeddingClient: EmbeddingClient
  vectorVersion: string
  log: (message: string) => void
}

// ---------------------------------------------------------------------------
// Embed documents
// ---------------------------------------------------------------------------

/**
 * Embed all documents in the store that are missing or stale
 * relative to the given vector version. Returns the number of
 * documents that were newly embedded.
 */
export async function embedDocuments(
  input: EmbedDocumentsInput,
): Promise<number> {
  const { memdirStore, embeddingClient, vectorVersion, log } = input
  const docs = await memdirStore.listDocuments()

  const needsEmbedding = docs.filter(
    (doc) => !doc.embedding || doc.embedding.version !== vectorVersion,
  )

  if (needsEmbedding.length === 0) return 0

  let embedded = 0

  for (const doc of needsEmbedding) {
    const text = `${doc.title}\n${doc.description}`
    const result = await embeddingClient.embed(text)

    if (result.ok) {
      const updated: MemdirDocument = {
        ...doc,
        embedding: {
          vector: result.vector,
          version: vectorVersion,
          embeddedAt: Date.now(),
        },
      }
      await memdirStore.putDocument(updated)
      embedded++
    } else {
      log(`Failed to embed doc "${doc.id}": ${result.error}`)
    }
  }

  return embedded
}

// ---------------------------------------------------------------------------
// Embed a single document (called during persist)
// ---------------------------------------------------------------------------

/**
 * Attempt to compute an embedding for a document and return an enriched
 * copy.  Does **not** persist — the caller is responsible for writing
 * the returned document to the store exactly once.
 *
 * If embedding fails the original document is returned unchanged so the
 * caller can still persist it without an embedding (fail-safe).
 */
export async function tryEnrichWithEmbedding(
  doc: MemdirDocument,
  embeddingClient: EmbeddingClient,
  vectorVersion: string,
  log: (message: string) => void,
): Promise<MemdirDocument> {
  const text = `${doc.title}\n${doc.description}`
  const result = await embeddingClient.embed(text)

  if (result.ok) {
    return {
      ...doc,
      embedding: {
        vector: result.vector,
        version: vectorVersion,
        embeddedAt: Date.now(),
      },
    }
  }

  log(`Failed to embed doc "${doc.id}": ${result.error}`)
  return doc
}

// ---------------------------------------------------------------------------
// Cache status computation
// ---------------------------------------------------------------------------

/**
 * Compute embedding cache status from the current set of documents
 * and the active vector version.
 *
 * @param supported - whether the configured embedding provider is
 *   recognised by the client.  Determined at the call-site in index.ts
 *   via `isProviderSupported()`.
 */
export function computeEmbeddingCacheStatus(
  docs: MemdirDocument[],
  currentVersion: string,
  enabled: boolean,
  supported: boolean,
): EmbeddingCacheStatus {
  if (!enabled) {
    return {
      enabled: false,
      supported,
      readyCount: 0,
      staleCount: 0,
      missingCount: 0,
      currentVersion: '',
    }
  }

  let readyCount = 0
  let staleCount = 0
  let missingCount = 0

  for (const doc of docs) {
    if (!doc.embedding) {
      missingCount++
    } else if (doc.embedding.version === currentVersion) {
      readyCount++
    } else {
      staleCount++
    }
  }

  return {
    enabled: true,
    supported,
    readyCount,
    staleCount,
    missingCount,
    currentVersion,
  }
}
