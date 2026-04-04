import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryAsyncStore } from './helpers/mockRisuai.js'
import { MemdirStore } from '../src/memory/memdirStore.js'
import type { MemdirDocument, MemdirIndex } from '../src/contracts/types.js'
import { MEMDIR_DOCUMENT_TYPES } from '../src/contracts/types.js'

describe('MemdirStore', () => {
  let storage: InMemoryAsyncStore
  let store: MemdirStore
  const scopeKey = 'scope:abc123:def456'

  beforeEach(() => {
    storage = new InMemoryAsyncStore()
    store = new MemdirStore(storage, scopeKey)
  })

  describe('index management', () => {
    it('creates an empty index when none exists', async () => {
      const index = await store.loadIndex()
      expect(index).toBeDefined()
      expect(index.scopeKey).toBe(scopeKey)
      expect(index.docIds).toEqual([])
      expect(typeof index.updatedAt).toBe('number')
      expect(typeof index.createdAt).toBe('number')
    })

    it('persists and reloads the index', async () => {
      const index = await store.loadIndex()
      // Store a doc to mutate index
      const doc: MemdirDocument = {
        id: 'doc-1',
        type: 'character',
        title: 'Character Sheet',
        description: 'Main character details',
        scopeKey,
        updatedAt: Date.now(),
        source: 'extraction',
        freshness: 'current',
        tags: ['protagonist'],
      }
      await store.putDocument(doc)

      // Create a new store instance pointing to same storage
      const store2 = new MemdirStore(storage, scopeKey)
      const reloaded = await store2.loadIndex()
      expect(reloaded.docIds).toContain('doc-1')
    })

    it('uses correct storage key namespace for index', async () => {
      await store.loadIndex()
      const keys = await storage.keys()
      const indexKey = keys.find((k) => k.startsWith('continuity-director-memdir:index:'))
      expect(indexKey).toBe(`continuity-director-memdir:index:${scopeKey}`)
    })
  })

  describe('document CRUD', () => {
    it('stores a document as an individually addressable record', async () => {
      const doc: MemdirDocument = {
        id: 'char-main',
        type: 'character',
        title: 'Protagonist',
        description: 'The main character',
        scopeKey,
        updatedAt: Date.now(),
        source: 'extraction',
        freshness: 'current',
        tags: ['main'],
      }
      await store.putDocument(doc)

      const retrieved = await store.getDocument('char-main')
      expect(retrieved).toBeDefined()
      expect(retrieved!.id).toBe('char-main')
      expect(retrieved!.title).toBe('Protagonist')
      expect(retrieved!.type).toBe('character')
    })

    it('uses correct storage key namespace for documents', async () => {
      const doc: MemdirDocument = {
        id: 'world-1',
        type: 'world',
        title: 'Setting',
        description: 'The world',
        scopeKey,
        updatedAt: Date.now(),
        source: 'extraction',
        freshness: 'current',
        tags: [],
      }
      await store.putDocument(doc)
      const keys = await storage.keys()
      const docKey = keys.find((k) =>
        k.startsWith('continuity-director-memdir:doc:'),
      )
      expect(docKey).toBe(
        `continuity-director-memdir:doc:${scopeKey}:world-1`,
      )
    })

    it('updates an existing document in place', async () => {
      const doc: MemdirDocument = {
        id: 'rel-1',
        type: 'relationship',
        title: 'A and B',
        description: 'Friends',
        scopeKey,
        updatedAt: 1000,
        source: 'extraction',
        freshness: 'current',
        tags: [],
      }
      await store.putDocument(doc)

      const updated: MemdirDocument = {
        ...doc,
        description: 'Rivals',
        updatedAt: 2000,
        freshness: 'stale',
      }
      await store.putDocument(updated)

      const retrieved = await store.getDocument('rel-1')
      expect(retrieved!.description).toBe('Rivals')
      expect(retrieved!.freshness).toBe('stale')

      // Should not duplicate in index
      const index = await store.loadIndex()
      const count = index.docIds.filter((id) => id === 'rel-1').length
      expect(count).toBe(1)
    })

    it('removes a document and updates the index', async () => {
      const doc: MemdirDocument = {
        id: 'plot-1',
        type: 'plot',
        title: 'Main Arc',
        description: 'The plot',
        scopeKey,
        updatedAt: Date.now(),
        source: 'extraction',
        freshness: 'current',
        tags: [],
      }
      await store.putDocument(doc)
      expect(await store.getDocument('plot-1')).toBeDefined()

      await store.removeDocument('plot-1')
      expect(await store.getDocument('plot-1')).toBeNull()

      const index = await store.loadIndex()
      expect(index.docIds).not.toContain('plot-1')
    })

    it('returns null for a non-existent document', async () => {
      const result = await store.getDocument('nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('listing with freshness', () => {
    it('lists documents newest-first by default', async () => {
      const docs: MemdirDocument[] = [
        {
          id: 'old',
          type: 'world',
          title: 'Old',
          description: 'Oldest',
          scopeKey,
          updatedAt: 1000,
          source: 'extraction',
          freshness: 'current',
          tags: [],
        },
        {
          id: 'mid',
          type: 'character',
          title: 'Mid',
          description: 'Middle',
          scopeKey,
          updatedAt: 2000,
          source: 'extraction',
          freshness: 'current',
          tags: [],
        },
        {
          id: 'new',
          type: 'relationship',
          title: 'New',
          description: 'Newest',
          scopeKey,
          updatedAt: 3000,
          source: 'extraction',
          freshness: 'current',
          tags: [],
        },
      ]
      for (const d of docs) await store.putDocument(d)

      const listed = await store.listDocuments()
      expect(listed.map((d) => d.id)).toEqual(['new', 'mid', 'old'])
    })

    it('includes freshness metadata in listed documents', async () => {
      const doc: MemdirDocument = {
        id: 'fresh-doc',
        type: 'continuity',
        title: 'Cont',
        description: 'Fresh fact',
        scopeKey,
        updatedAt: Date.now(),
        source: 'extraction',
        freshness: 'current',
        tags: [],
      }
      await store.putDocument(doc)

      const listed = await store.listDocuments()
      expect(listed[0]!.freshness).toBe('current')
      expect(listed[0]!.updatedAt).toBe(doc.updatedAt)
    })

    it('filters documents by type', async () => {
      const docs: MemdirDocument[] = [
        {
          id: 'c1',
          type: 'character',
          title: 'Char',
          description: '',
          scopeKey,
          updatedAt: 1000,
          source: 'extraction',
          freshness: 'current',
          tags: [],
        },
        {
          id: 'w1',
          type: 'world',
          title: 'World',
          description: '',
          scopeKey,
          updatedAt: 2000,
          source: 'extraction',
          freshness: 'current',
          tags: [],
        },
      ]
      for (const d of docs) await store.putDocument(d)

      const chars = await store.listDocuments({ type: 'character' })
      expect(chars).toHaveLength(1)
      expect(chars[0]!.id).toBe('c1')
    })
  })

  describe('document type taxonomy', () => {
    it('defines the RP memory taxonomy', () => {
      expect(MEMDIR_DOCUMENT_TYPES).toEqual([
        'character',
        'relationship',
        'world',
        'plot',
        'continuity',
        'operator',
      ])
    })

    it('accepts all taxonomy types in documents', async () => {
      for (const type of MEMDIR_DOCUMENT_TYPES) {
        const doc: MemdirDocument = {
          id: `doc-${type}`,
          type: type as MemdirDocument['type'],
          title: type,
          description: `A ${type} doc`,
          scopeKey,
          updatedAt: Date.now(),
          source: 'extraction',
          freshness: 'current',
          tags: [],
        }
        await store.putDocument(doc)
        const retrieved = await store.getDocument(`doc-${type}`)
        expect(retrieved).toBeDefined()
        expect(retrieved!.type).toBe(type)
      }
    })
  })

  describe('embedding metadata on documents', () => {
    it('stores and retrieves a document with embedding metadata', async () => {
      const doc: MemdirDocument = {
        id: 'emb-1',
        type: 'character',
        title: 'Alice',
        description: 'A warrior',
        scopeKey,
        updatedAt: Date.now(),
        source: 'extraction',
        freshness: 'current',
        tags: [],
        embedding: {
          vector: [0.1, 0.2, 0.3],
          version: 'emb-abc123',
          embeddedAt: Date.now(),
        },
      }
      await store.putDocument(doc)
      const retrieved = await store.getDocument('emb-1')
      expect(retrieved!.embedding).toBeDefined()
      expect(retrieved!.embedding!.vector).toEqual([0.1, 0.2, 0.3])
      expect(retrieved!.embedding!.version).toBe('emb-abc123')
    })

    it('document without embedding has undefined embedding field', async () => {
      const doc: MemdirDocument = {
        id: 'no-emb-1',
        type: 'world',
        title: 'Place',
        description: 'A place',
        scopeKey,
        updatedAt: Date.now(),
        source: 'extraction',
        freshness: 'current',
        tags: [],
      }
      await store.putDocument(doc)
      const retrieved = await store.getDocument('no-emb-1')
      expect(retrieved!.embedding).toBeUndefined()
    })

    it('updates embedding metadata on an existing document', async () => {
      const doc: MemdirDocument = {
        id: 'upd-emb-1',
        type: 'character',
        title: 'Bob',
        description: 'A mage',
        scopeKey,
        updatedAt: 1000,
        source: 'extraction',
        freshness: 'current',
        tags: [],
        embedding: {
          vector: [0.1, 0.2],
          version: 'emb-v1',
          embeddedAt: 1000,
        },
      }
      await store.putDocument(doc)

      const updated: MemdirDocument = {
        ...doc,
        updatedAt: 2000,
        embedding: {
          vector: [0.3, 0.4],
          version: 'emb-v2',
          embeddedAt: 2000,
        },
      }
      await store.putDocument(updated)

      const retrieved = await store.getDocument('upd-emb-1')
      expect(retrieved!.embedding!.version).toBe('emb-v2')
      expect(retrieved!.embedding!.vector).toEqual([0.3, 0.4])
    })

    it('counts embedding status across documents', async () => {
      const docs: MemdirDocument[] = [
        {
          id: 'e1', type: 'character', title: 'A', description: 'a',
          scopeKey, updatedAt: 1, source: 'extraction', freshness: 'current',
          tags: [],
          embedding: { vector: [0.1], version: 'emb-v1', embeddedAt: 1 },
        },
        {
          id: 'e2', type: 'world', title: 'B', description: 'b',
          scopeKey, updatedAt: 2, source: 'extraction', freshness: 'current',
          tags: [],
          embedding: { vector: [0.2], version: 'emb-v2', embeddedAt: 2 },
        },
        {
          id: 'e3', type: 'plot', title: 'C', description: 'c',
          scopeKey, updatedAt: 3, source: 'extraction', freshness: 'current',
          tags: [],
        },
      ]
      for (const d of docs) await store.putDocument(d)

      const allDocs = await store.listDocuments()
      const withEmb = allDocs.filter((d) => d.embedding != null)
      const withoutEmb = allDocs.filter((d) => d.embedding == null)

      expect(withEmb).toHaveLength(2)
      expect(withoutEmb).toHaveLength(1)
    })
  })

  describe('MEMORY.md key', () => {
    it('uses the dedicated memory-md namespace key', async () => {
      const memoryMd = '# MEMORY.md\n\nNo documents yet.'
      await store.putMemoryMd(memoryMd)

      const keys = await storage.keys()
      const mdKey = keys.find((k) =>
        k.startsWith('continuity-director-memdir:memory-md:'),
      )
      expect(mdKey).toBe(`continuity-director-memdir:memory-md:${scopeKey}`)
    })

    it('stores and retrieves the MEMORY.md content', async () => {
      const content = '# MEMORY.md\n\n## Characters\n- Alice'
      await store.putMemoryMd(content)

      const retrieved = await store.getMemoryMd()
      expect(retrieved).toBe(content)
    })

    it('returns null when no MEMORY.md exists', async () => {
      const result = await store.getMemoryMd()
      expect(result).toBeNull()
    })
  })
})
