import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryAsyncStore } from './helpers/mockRisuai.js'
import { MemdirStore } from '../src/memory/memdirStore.js'
import { buildMemoryMd, migrateCanonicalToMemdir } from '../src/memory/memoryDocuments.js'
import { createEmptyState } from '../src/contracts/types.js'
import type { DirectorPluginState, MemdirDocument } from '../src/contracts/types.js'

describe('buildMemoryMd', () => {
  it('produces a MEMORY.md even when there are zero documents', () => {
    const md = buildMemoryMd([], { tokenBudget: 500 })
    expect(md).toContain('# MEMORY.md')
    expect(typeof md).toBe('string')
    expect(md.length).toBeGreaterThan(0)
  })

  it('includes document titles grouped by type', () => {
    const docs: MemdirDocument[] = [
      {
        id: 'c1',
        type: 'character',
        title: 'Alice',
        description: 'Main protagonist',
        scopeKey: 'scope:x:y',
        updatedAt: Date.now(),
        source: 'extraction',
        freshness: 'current',
        tags: [],
      },
      {
        id: 'w1',
        type: 'world',
        title: 'Fantasy Kingdom',
        description: 'The main setting',
        scopeKey: 'scope:x:y',
        updatedAt: Date.now(),
        source: 'extraction',
        freshness: 'current',
        tags: [],
      },
    ]
    const md = buildMemoryMd(docs, { tokenBudget: 1000 })
    expect(md).toContain('Alice')
    expect(md).toContain('Fantasy Kingdom')
    expect(md).toContain('character')
    expect(md).toContain('world')
  })

  it('respects token budget by truncating', () => {
    const docs: MemdirDocument[] = Array.from({ length: 50 }, (_, i) => ({
      id: `doc-${i}`,
      type: 'world' as const,
      title: `World Fact ${i} ${'x'.repeat(100)}`,
      description: `Description ${i} ${'detail '.repeat(50)}`,
      scopeKey: 'scope:x:y',
      updatedAt: Date.now() - i * 1000,
      source: 'extraction' as const,
      freshness: 'current' as const,
      tags: [],
    }))
    const md = buildMemoryMd(docs, { tokenBudget: 200 })
    // Rough estimate: 200 tokens ≈ ~800 chars. The output should be bounded.
    // We verify it's shorter than an unbounded version would be.
    const unbounded = buildMemoryMd(docs, { tokenBudget: 100_000 })
    expect(md.length).toBeLessThan(unbounded.length)
  })

  it('marks stale documents with freshness indicator', () => {
    const docs: MemdirDocument[] = [
      {
        id: 's1',
        type: 'continuity',
        title: 'Stale Fact',
        description: 'This is outdated',
        scopeKey: 'scope:x:y',
        updatedAt: Date.now() - 86400000,
        source: 'extraction',
        freshness: 'stale',
        tags: [],
      },
    ]
    const md = buildMemoryMd(docs, { tokenBudget: 500 })
    expect(md).toContain('stale')
  })
})

describe('migrateCanonicalToMemdir', () => {
  let storage: InMemoryAsyncStore
  let store: MemdirStore
  const scopeKey = 'scope:test:migrate'

  beforeEach(() => {
    storage = new InMemoryAsyncStore()
    store = new MemdirStore(storage, scopeKey)
  })

  it('creates documents from canonical entities', async () => {
    const state = createEmptyState()
    state.memory.entities = [
      {
        id: 'ent-1',
        name: 'Alice',
        facts: ['She is brave', 'She is clever'],
        tags: ['protagonist'],
        updatedAt: Date.now(),
      },
    ]

    const result = await migrateCanonicalToMemdir(state, store)
    expect(result.migratedCount).toBeGreaterThanOrEqual(1)

    const docs = await store.listDocuments()
    const charDoc = docs.find(
      (d) => d.type === 'character' && d.title === 'Alice',
    )
    expect(charDoc).toBeDefined()
    expect(charDoc!.description).toContain('brave')
  })

  it('creates documents from canonical relations', async () => {
    const state = createEmptyState()
    state.memory.relations = [
      {
        id: 'rel-1',
        sourceId: 'alice',
        targetId: 'bob',
        label: 'rivals',
        facts: ['They compete for the throne'],
        updatedAt: Date.now(),
      },
    ]

    const result = await migrateCanonicalToMemdir(state, store)
    expect(result.migratedCount).toBeGreaterThanOrEqual(1)

    const docs = await store.listDocuments()
    const relDoc = docs.find((d) => d.type === 'relationship')
    expect(relDoc).toBeDefined()
    expect(relDoc!.description).toContain('rivals')
  })

  it('creates documents from canonical world facts', async () => {
    const state = createEmptyState()
    state.memory.worldFacts = [
      {
        id: 'wf-1',
        text: 'Magic is common in this world',
        tags: ['magic'],
        updatedAt: Date.now(),
      },
    ]

    const result = await migrateCanonicalToMemdir(state, store)
    expect(result.migratedCount).toBeGreaterThanOrEqual(1)

    const docs = await store.listDocuments()
    const worldDoc = docs.find((d) => d.type === 'world')
    expect(worldDoc).toBeDefined()
    expect(worldDoc!.description).toContain('Magic is common')
  })

  it('creates documents from canonical continuity facts', async () => {
    const state = createEmptyState()
    state.memory.continuityFacts = [
      {
        id: 'cf-1',
        text: 'Alice promised to return the sword',
        priority: 5,
      },
    ]

    const result = await migrateCanonicalToMemdir(state, store)
    expect(result.migratedCount).toBeGreaterThanOrEqual(1)

    const docs = await store.listDocuments()
    const contDoc = docs.find((d) => d.type === 'continuity')
    expect(contDoc).toBeDefined()
    expect(contDoc!.description).toContain('sword')
  })

  it('creates documents from canonical summaries', async () => {
    const state = createEmptyState()
    state.memory.summaries = [
      {
        id: 'sum-1',
        text: 'The party entered the dark forest',
        recencyWeight: 0.8,
        updatedAt: Date.now(),
      },
    ]

    const result = await migrateCanonicalToMemdir(state, store)
    expect(result.migratedCount).toBeGreaterThanOrEqual(1)

    const docs = await store.listDocuments()
    const plotDoc = docs.find((d) => d.type === 'plot')
    expect(plotDoc).toBeDefined()
    expect(plotDoc!.description).toContain('dark forest')
  })

  it('does not delete legacy canonical state', async () => {
    const state = createEmptyState()
    state.memory.entities = [
      {
        id: 'ent-keep',
        name: 'Bob',
        facts: ['He is a wizard'],
        updatedAt: Date.now(),
      },
    ]
    state.memory.worldFacts = [
      {
        id: 'wf-keep',
        text: 'Dragons exist',
        updatedAt: Date.now(),
      },
    ]

    await migrateCanonicalToMemdir(state, store)

    // Legacy state should be untouched
    expect(state.memory.entities).toHaveLength(1)
    expect(state.memory.entities[0]!.name).toBe('Bob')
    expect(state.memory.worldFacts).toHaveLength(1)
    expect(state.memory.worldFacts[0]!.text).toBe('Dragons exist')
  })

  it('handles empty canonical memory gracefully', async () => {
    const state = createEmptyState()
    const result = await migrateCanonicalToMemdir(state, store)
    expect(result.migratedCount).toBe(0)

    const docs = await store.listDocuments()
    expect(docs).toHaveLength(0)
  })

  it('is idempotent — re-running does not create duplicates', async () => {
    const state = createEmptyState()
    state.memory.entities = [
      {
        id: 'ent-idem',
        name: 'Carol',
        facts: ['She is a healer'],
        updatedAt: Date.now(),
      },
    ]

    await migrateCanonicalToMemdir(state, store)
    await migrateCanonicalToMemdir(state, store)

    const docs = await store.listDocuments()
    const carolDocs = docs.filter((d) => d.title === 'Carol')
    expect(carolDocs).toHaveLength(1)
  })

  it('assigns the store scopeKey — not state.projectKey — to every migrated document', async () => {
    const state = createEmptyState()
    // Ensure state.projectKey differs from the store's scopeKey
    expect(state.projectKey).not.toBe(scopeKey)

    state.memory.entities = [
      { id: 'ent-scope', name: 'ScopeCheck', facts: ['f1'], updatedAt: Date.now() },
    ]
    state.memory.relations = [
      { id: 'rel-scope', sourceId: 'a', targetId: 'b', label: 'ally', facts: [], updatedAt: Date.now() },
    ]
    state.memory.worldFacts = [
      { id: 'wf-scope', text: 'World scope fact', updatedAt: Date.now() },
    ]
    state.memory.continuityFacts = [
      { id: 'cf-scope', text: 'Continuity scope fact', priority: 1 },
    ]
    state.memory.summaries = [
      { id: 'sum-scope', text: 'Summary scope fact', recencyWeight: 0.5, updatedAt: Date.now() },
    ]

    await migrateCanonicalToMemdir(state, store)
    const docs = await store.listDocuments()
    expect(docs.length).toBeGreaterThan(0)

    for (const doc of docs) {
      expect(doc.scopeKey).toBe(scopeKey)
    }
  })
})
