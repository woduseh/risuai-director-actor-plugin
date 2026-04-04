/**
 * Embedding integration helpers.
 *
 * Connects the embedding client, vector version, and memdir store
 * to support:
 *  - embedding newly persisted documents
 *  - refreshing embeddings for all documents in a scope
 *  - computing embedding cache status for dashboard reporting
 */

import type { MemdirDocument } from '../contracts/types.js'
import type { EmbeddingClient } from './embeddingClient.js'
import type { MemdirStore } from './memdirStore.js'
import type { EmbeddingCacheStatus } from '../ui/dashboardState.js'

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
 * Embed a single document if embeddings are enabled.
 * Returns true if embedding was successful, false otherwise.
 */
export async function embedSingleDocument(
  doc: MemdirDocument,
  memdirStore: MemdirStore,
  embeddingClient: EmbeddingClient,
  vectorVersion: string,
  log: (message: string) => void,
): Promise<boolean> {
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
    return true
  }

  log(`Failed to embed doc "${doc.id}": ${result.error}`)
  return false
}

// ---------------------------------------------------------------------------
// Cache status computation
// ---------------------------------------------------------------------------

/**
 * Compute embedding cache status from the current set of documents
 * and the active vector version.
 */
export function computeEmbeddingCacheStatus(
  docs: MemdirDocument[],
  currentVersion: string,
  enabled: boolean,
): EmbeddingCacheStatus {
  if (!enabled) {
    return {
      enabled: false,
      supported: true,
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
    supported: true,
    readyCount,
    staleCount,
    missingCount,
    currentVersion,
  }
}
