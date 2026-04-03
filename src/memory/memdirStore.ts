import type { AsyncKeyValueStore } from '../contracts/risuai.js'
import type { MemdirDocument, MemdirIndex } from '../contracts/types.js'

const NS_INDEX = 'director-memdir:index'
const NS_DOC = 'director-memdir:doc'
const NS_MEMORY_MD = 'director-memdir:memory-md'

function indexKey(scopeKey: string): string {
  return `${NS_INDEX}:${scopeKey}`
}

function docKey(scopeKey: string, docId: string): string {
  return `${NS_DOC}:${scopeKey}:${docId}`
}

function memoryMdKey(scopeKey: string): string {
  return `${NS_MEMORY_MD}:${scopeKey}`
}

export interface ListDocumentsOptions {
  type?: MemdirDocument['type']
}

/**
 * Virtual memdir store backed by an {@link AsyncKeyValueStore}.
 *
 * Each scope has its own index (manifest) listing all document IDs,
 * and each document is stored as an individually addressable record
 * under a dedicated namespace key.
 */
export class MemdirStore {
  private readonly storage: AsyncKeyValueStore
  private readonly _scopeKey: string
  private indexCache: MemdirIndex | null = null

  constructor(storage: AsyncKeyValueStore, scopeKey: string) {
    this.storage = storage
    this._scopeKey = scopeKey
  }

  get scopeKey(): string {
    return this._scopeKey
  }

  async loadIndex(): Promise<MemdirIndex> {
    const raw = await this.storage.getItem<MemdirIndex>(
      indexKey(this.scopeKey),
    )
    if (raw != null && typeof raw === 'object' && Array.isArray(raw.docIds)) {
      this.indexCache = raw
      return structuredClone(raw)
    }
    const now = Date.now()
    const fresh: MemdirIndex = {
      scopeKey: this.scopeKey,
      docIds: [],
      createdAt: now,
      updatedAt: now,
    }
    this.indexCache = fresh
    await this.storage.setItem(indexKey(this.scopeKey), structuredClone(fresh))
    return structuredClone(fresh)
  }

  private async ensureIndex(): Promise<MemdirIndex> {
    if (this.indexCache != null) return this.indexCache
    return this.loadIndex()
  }

  private async persistIndex(index: MemdirIndex): Promise<void> {
    index.updatedAt = Date.now()
    this.indexCache = index
    await this.storage.setItem(
      indexKey(this.scopeKey),
      structuredClone(index),
    )
  }

  async putDocument(doc: MemdirDocument): Promise<void> {
    await this.storage.setItem(
      docKey(this.scopeKey, doc.id),
      structuredClone(doc),
    )
    const index = await this.ensureIndex()
    if (!index.docIds.includes(doc.id)) {
      index.docIds.push(doc.id)
      await this.persistIndex(index)
    }
  }

  async getDocument(docId: string): Promise<MemdirDocument | null> {
    const raw = await this.storage.getItem<MemdirDocument>(
      docKey(this.scopeKey, docId),
    )
    return raw ?? null
  }

  async removeDocument(docId: string): Promise<void> {
    await this.storage.removeItem(docKey(this.scopeKey, docId))
    const index = await this.ensureIndex()
    index.docIds = index.docIds.filter((id) => id !== docId)
    await this.persistIndex(index)
  }

  async listDocuments(
    options?: ListDocumentsOptions,
  ): Promise<MemdirDocument[]> {
    const index = await this.ensureIndex()
    const docs: MemdirDocument[] = []
    for (const id of index.docIds) {
      const doc = await this.getDocument(id)
      if (doc == null) continue
      if (options?.type != null && doc.type !== options.type) continue
      docs.push(doc)
    }
    // Newest-first
    docs.sort((a, b) => b.updatedAt - a.updatedAt)
    return docs
  }

  async putMemoryMd(content: string): Promise<void> {
    await this.storage.setItem(memoryMdKey(this.scopeKey), content)
  }

  async getMemoryMd(): Promise<string | null> {
    const raw = await this.storage.getItem<string>(
      memoryMdKey(this.scopeKey),
    )
    return raw ?? null
  }
}
