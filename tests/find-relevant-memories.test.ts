import { describe, test, expect, vi } from 'vitest'
import {
  formatManifest,
  findRelevantMemories,
  RecallCache,
  formatRecalledDocsBlock,
  type RecallDeps,
  type RecallResult,
} from '../src/memory/findRelevantMemories.js'
import type { MemdirDocument } from '../src/contracts/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(overrides?: Partial<MemdirDocument>): MemdirDocument {
  return {
    id: 'doc-1',
    type: 'character',
    title: 'Alice the Warrior',
    description:
      'Alice is a fierce warrior who wields a magical sword and guards the northern gate.',
    scopeKey: 'test-scope',
    updatedAt: Date.now(),
    source: 'extraction',
    freshness: 'current',
    tags: ['alice', 'warrior'],
    ...overrides,
  }
}

function makeDeps(overrides?: Partial<RecallDeps>): RecallDeps {
  return {
    runRecallModel: vi.fn(async () => ({ ok: true, text: '["doc-1"]' })),
    log: vi.fn(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// formatManifest — header scan without full document bodies
// ---------------------------------------------------------------------------

describe('formatManifest', () => {
  test('produces header-only output without full document bodies', () => {
    const docs = [
      makeDoc({
        id: 'doc-1',
        type: 'character',
        title: 'Alice',
        description:
          'Very long description about Alice that should not appear in manifest output at all.',
        freshness: 'current',
        tags: ['protagonist'],
      }),
      makeDoc({
        id: 'doc-2',
        type: 'world',
        title: 'Northern Gate',
        description:
          'Detailed world-building about the gate that absolutely should not be in manifest.',
        freshness: 'stale',
        tags: ['location'],
      }),
    ]

    const manifest = formatManifest(docs)

    // Headers present
    expect(manifest).toContain('doc-1')
    expect(manifest).toContain('doc-2')
    expect(manifest).toContain('Alice')
    expect(manifest).toContain('Northern Gate')
    expect(manifest).toContain('character')
    expect(manifest).toContain('world')

    // Full descriptions absent
    expect(manifest).not.toContain('Very long description')
    expect(manifest).not.toContain('Detailed world-building')
  })

  test('returns placeholder for empty doc list', () => {
    const manifest = formatManifest([])
    expect(manifest.length).toBeGreaterThan(0)
  })

  test('includes freshness tag for non-current documents', () => {
    const docs = [
      makeDoc({ id: 'd1', freshness: 'stale' }),
      makeDoc({ id: 'd2', freshness: 'archived' }),
      makeDoc({ id: 'd3', freshness: 'current' }),
    ]

    const manifest = formatManifest(docs)
    expect(manifest).toContain('stale')
    expect(manifest).toContain('archived')
  })
})

// ---------------------------------------------------------------------------
// findRelevantMemories — recall model call selecting bounded set
// ---------------------------------------------------------------------------

describe('findRelevantMemories', () => {
  test('recall model call selects a bounded set of memory doc IDs', async () => {
    const docs = [
      makeDoc({ id: 'doc-1', title: 'Alice' }),
      makeDoc({ id: 'doc-2', title: 'Bob' }),
      makeDoc({ id: 'doc-3', title: 'Charlie' }),
    ]

    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({
        ok: true,
        text: '["doc-1","doc-3"]',
      })),
    })

    const result = await findRelevantMemories(deps, {
      docs,
      recentText: 'Alice met Charlie at the gate',
      memoryMdContent: '# MEMORY.md\nTest content',
      maxResults: 5,
    })

    expect(result.source).toBe('recall')
    expect(result.selectedDocs).toHaveLength(2)
    expect(result.selectedDocs.map((d) => d.id)).toEqual(['doc-1', 'doc-3'])
  })

  test('respects maxResults bound on selected IDs', async () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      makeDoc({ id: `doc-${i}`, title: `Doc ${i}` }),
    )

    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({
        ok: true,
        text: JSON.stringify(docs.map((d) => d.id)),
      })),
    })

    const result = await findRelevantMemories(deps, {
      docs,
      recentText: 'query text',
      memoryMdContent: '# MEMORY.md',
      maxResults: 3,
    })

    expect(result.selectedDocs.length).toBeLessThanOrEqual(3)
  })

  // ── Fallback on malformed / failed output ─────────────────────────────

  test('falls back to deterministic keyword retrieval on malformed recall output', async () => {
    const docs = [
      makeDoc({
        id: 'doc-1',
        title: 'Alice the Warrior',
        description: 'Alice guards the northern gate',
      }),
      makeDoc({
        id: 'doc-2',
        title: 'Bob the Mage',
        description: 'Bob studies elemental magic in the tower',
      }),
    ]

    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({
        ok: true,
        text: 'This is not valid JSON at all!!!',
      })),
    })

    const result = await findRelevantMemories(deps, {
      docs,
      recentText: 'Alice opened the gate',
      memoryMdContent: '# MEMORY.md',
    })

    expect(result.source).toBe('fallback')
    expect(result.selectedDocs.length).toBeGreaterThan(0)
  })

  test('falls back when recall model call fails', async () => {
    const docs = [makeDoc({ id: 'doc-1', title: 'Alice' })]

    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({
        ok: false,
        text: 'rate limited',
      })),
    })

    const result = await findRelevantMemories(
      deps,
      {
        docs,
        recentText: 'Something happens',
        memoryMdContent: '# MEMORY.md',
      },
      undefined,
      { maxRetries: 0 },
    )

    expect(result.source).toBe('fallback')
    expect(deps.log).toHaveBeenCalled()
  })

  test('falls back when recall model throws', async () => {
    const deps = makeDeps({
      runRecallModel: vi.fn(async () => {
        throw new Error('network error')
      }),
    })

    const result = await findRelevantMemories(deps, {
      docs: [makeDoc()],
      recentText: 'query',
      memoryMdContent: '# MEMORY.md',
    })

    expect(result.source).toBe('fallback')
  })

  // ── Freshness warnings ────────────────────────────────────────────────

  test('adds freshness warning text for stale recalled memories', async () => {
    const staleDocs = [
      makeDoc({ id: 'doc-stale', title: 'Old Event', freshness: 'stale' }),
      makeDoc({
        id: 'doc-archived',
        title: 'Ancient Lore',
        freshness: 'archived',
      }),
    ]

    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({
        ok: true,
        text: '["doc-stale","doc-archived"]',
      })),
    })

    const result = await findRelevantMemories(deps, {
      docs: staleDocs,
      recentText: 'Remember the old event',
      memoryMdContent: '# MEMORY.md',
    })

    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.some((w) => w.includes('stale'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('Old Event'))).toBe(true)
  })

  test('no freshness warnings for current documents', async () => {
    const docs = [makeDoc({ id: 'doc-1', freshness: 'current' })]

    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({
        ok: true,
        text: '["doc-1"]',
      })),
    })

    const result = await findRelevantMemories(deps, {
      docs,
      recentText: 'query',
      memoryMdContent: '# MEMORY.md',
    })

    expect(result.warnings).toEqual([])
  })

  // ── MEMORY.md always injected ─────────────────────────────────────────

  test('always includes MEMORY.md block even when no docs are recalled', async () => {
    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({ ok: true, text: '[]' })),
    })

    const result = await findRelevantMemories(deps, {
      docs: [],
      recentText: 'Hello',
      memoryMdContent: '# MEMORY.md\nNo docs yet',
    })

    expect(result.memoryMdBlock).toContain('MEMORY.md')
  })

  // ── Retry with exponential backoff ────────────────────────────────

  test('retries transient recall thrown errors and succeeds on later attempt', async () => {
    let callCount = 0
    const docs = [makeDoc({ id: 'doc-1' })]
    const deps = makeDeps({
      runRecallModel: vi.fn(async () => {
        callCount++
        if (callCount === 1) throw new Error('503 Service Unavailable')
        return { ok: true, text: '["doc-1"]' }
      }),
    })

    const result = await findRelevantMemories(
      deps,
      { docs, recentText: 'query', memoryMdContent: '# MEMORY.md' },
      undefined,
      { baseDelayMs: 0 },
    )

    expect(result.source).toBe('recall')
    expect(deps.runRecallModel).toHaveBeenCalledTimes(2)
  })

  test('retries transient recall failure responses (ok=false with transient text)', async () => {
    let callCount = 0
    const docs = [makeDoc({ id: 'doc-1' })]
    const deps = makeDeps({
      runRecallModel: vi.fn(async () => {
        callCount++
        if (callCount === 1) return { ok: false, text: '429 rate limit exceeded' }
        return { ok: true, text: '["doc-1"]' }
      }),
    })

    const result = await findRelevantMemories(
      deps,
      { docs, recentText: 'query', memoryMdContent: '# MEMORY.md' },
      undefined,
      { baseDelayMs: 0 },
    )

    expect(result.source).toBe('recall')
    expect(deps.runRecallModel).toHaveBeenCalledTimes(2)
  })

  test('does not retry malformed recall output — falls back immediately', async () => {
    const docs = [
      makeDoc({ id: 'doc-1', title: 'Alice', description: 'Alice guards the gate' }),
    ]
    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({
        ok: true,
        text: 'This is not valid JSON at all!!!',
      })),
    })

    const result = await findRelevantMemories(
      deps,
      { docs, recentText: 'Alice opened the gate', memoryMdContent: '# MEMORY.md' },
      undefined,
      { baseDelayMs: 0 },
    )

    expect(result.source).toBe('fallback')
    expect(deps.runRecallModel).toHaveBeenCalledTimes(1)
  })

  test('does not retry non-transient recall failure responses', async () => {
    const docs = [makeDoc({ id: 'doc-1' })]
    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({
        ok: false,
        text: 'invalid API key',
      })),
    })

    const result = await findRelevantMemories(
      deps,
      { docs, recentText: 'query', memoryMdContent: '# MEMORY.md' },
      undefined,
      { baseDelayMs: 0 },
    )

    expect(result.source).toBe('fallback')
    expect(deps.runRecallModel).toHaveBeenCalledTimes(1)
  })

  test('falls back after exhausting retries on transient recall errors', async () => {
    const docs = [makeDoc({ id: 'doc-1' })]
    const deps = makeDeps({
      runRecallModel: vi.fn(async () => {
        throw new Error('503 Service Unavailable')
      }),
    })

    const result = await findRelevantMemories(
      deps,
      { docs, recentText: 'query', memoryMdContent: '# MEMORY.md' },
      undefined,
      { baseDelayMs: 0, maxRetries: 2 },
    )

    expect(result.source).toBe('fallback')
    expect(deps.runRecallModel).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })

  // ── JSON repair integration ──────────────────────────────────────────

  test('recall parses fenced JSON array response', async () => {
    const docs = [
      makeDoc({ id: 'doc-1', title: 'Alice' }),
      makeDoc({ id: 'doc-2', title: 'Bob' }),
    ]
    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({
        ok: true,
        text: '```json\n["doc-1","doc-2"]\n```',
      })),
    })

    const result = await findRelevantMemories(deps, {
      docs,
      recentText: 'Alice and Bob',
      memoryMdContent: '# MEMORY.md',
    })

    expect(result.source).toBe('recall')
    expect(result.selectedDocs).toHaveLength(2)
  })

  test('recall parses prose-wrapped JSON array with trailing commas', async () => {
    const docs = [makeDoc({ id: 'doc-1' })]
    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({
        ok: true,
        text: 'Here are the relevant IDs:\n["doc-1",]\nDone.',
      })),
    })

    const result = await findRelevantMemories(deps, {
      docs,
      recentText: 'query',
      memoryMdContent: '# MEMORY.md',
    })

    expect(result.source).toBe('recall')
    expect(result.selectedDocs).toHaveLength(1)
  })

  test('recall parses array with smart quotes', async () => {
    const docs = [makeDoc({ id: 'doc-1' })]
    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({
        ok: true,
        text: '[\u201Cdoc-1\u201D]',
      })),
    })

    const result = await findRelevantMemories(deps, {
      docs,
      recentText: 'query',
      memoryMdContent: '# MEMORY.md',
    })

    expect(result.source).toBe('recall')
    expect(result.selectedDocs).toHaveLength(1)
  })

  test('recall rejects arrays with non-string IDs (falls back)', async () => {
    const docs = [makeDoc({ id: 'doc-1' })]
    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({
        ok: true,
        text: '[123, 456]',
      })),
    })

    const result = await findRelevantMemories(deps, {
      docs,
      recentText: 'query',
      memoryMdContent: '# MEMORY.md',
    })

    expect(result.source).toBe('fallback')
  })

  test('recall still falls back on non-JSON garbage', async () => {
    const docs = [makeDoc({ id: 'doc-1' })]
    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({
        ok: true,
        text: 'I cannot provide IDs right now, sorry!',
      })),
    })

    const result = await findRelevantMemories(deps, {
      docs,
      recentText: 'query',
      memoryMdContent: '# MEMORY.md',
    })

    expect(result.source).toBe('fallback')
  })
})

// ---------------------------------------------------------------------------
// RecallCache — recallCooldownMs
// ---------------------------------------------------------------------------

describe('RecallCache', () => {
  test('reuses recent recall results when within cooldown period', () => {
    const cache = new RecallCache(10_000)
    const result: RecallResult = {
      selectedDocs: [makeDoc()],
      warnings: [],
      source: 'recall',
      memoryMdBlock: '# MEMORY.md',
    }

    cache.set(result, 1000)
    const cached = cache.get(5000) // 4 s later, within 10 s cooldown

    expect(cached).not.toBeNull()
    expect(cached!.selectedDocs).toEqual(result.selectedDocs)
  })

  test('returns null when cooldown has expired', () => {
    const cache = new RecallCache(10_000)
    const result: RecallResult = {
      selectedDocs: [makeDoc()],
      warnings: [],
      source: 'recall',
      memoryMdBlock: '# MEMORY.md',
    }

    cache.set(result, 1000)
    const cached = cache.get(15_000) // 14 s later, past 10 s cooldown

    expect(cached).toBeNull()
  })

  test('findRelevantMemories reuses cache within cooldown', async () => {
    const cache = new RecallCache(10_000)
    const docs = [makeDoc({ id: 'doc-1' })]

    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({
        ok: true,
        text: '["doc-1"]',
      })),
    })

    // First call — cache miss, calls model
    await findRelevantMemories(
      deps,
      { docs, recentText: 'q', memoryMdContent: 'md', nowMs: 1000 },
      cache,
    )
    expect(deps.runRecallModel).toHaveBeenCalledTimes(1)

    // Second call within cooldown — cache hit, no model call
    const result = await findRelevantMemories(
      deps,
      { docs, recentText: 'q2', memoryMdContent: 'md', nowMs: 5000 },
      cache,
    )
    expect(deps.runRecallModel).toHaveBeenCalledTimes(1) // still 1
    expect(result.source).toBe('cache')
  })

  test('repeated model failures within cooldown reuse cached fallback (response.ok=false)', async () => {
    const cache = new RecallCache(10_000)
    const docs = [makeDoc({ id: 'doc-1', title: 'Alice' })]

    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({ ok: false, text: 'rate limited' })),
    })

    // First call — model fails, returns fallback and caches it
    const r1 = await findRelevantMemories(
      deps,
      { docs, recentText: 'q', memoryMdContent: 'md', nowMs: 1000 },
      cache,
      { maxRetries: 0 },
    )
    expect(r1.source).toBe('fallback')
    expect(deps.runRecallModel).toHaveBeenCalledTimes(1)

    // Second call within cooldown — should reuse cache, no model call
    const r2 = await findRelevantMemories(
      deps,
      { docs, recentText: 'q2', memoryMdContent: 'md', nowMs: 5000 },
      cache,
      { maxRetries: 0 },
    )
    expect(deps.runRecallModel).toHaveBeenCalledTimes(1)
    expect(r2.source).toBe('cache')
  })

  test('repeated model failures within cooldown reuse cached fallback (malformed response)', async () => {
    const cache = new RecallCache(10_000)
    const docs = [makeDoc({ id: 'doc-1', title: 'Alice' })]

    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({
        ok: true,
        text: 'not valid json',
      })),
    })

    const r1 = await findRelevantMemories(
      deps,
      { docs, recentText: 'q', memoryMdContent: 'md', nowMs: 1000 },
      cache,
    )
    expect(r1.source).toBe('fallback')
    expect(deps.runRecallModel).toHaveBeenCalledTimes(1)

    const r2 = await findRelevantMemories(
      deps,
      { docs, recentText: 'q2', memoryMdContent: 'md', nowMs: 5000 },
      cache,
    )
    expect(deps.runRecallModel).toHaveBeenCalledTimes(1)
    expect(r2.source).toBe('cache')
  })

  test('repeated model failures within cooldown reuse cached fallback (thrown error)', async () => {
    const cache = new RecallCache(10_000)
    const docs = [makeDoc({ id: 'doc-1', title: 'Alice' })]

    const deps = makeDeps({
      runRecallModel: vi.fn(async () => {
        throw new Error('network error')
      }),
    })

    const r1 = await findRelevantMemories(
      deps,
      { docs, recentText: 'q', memoryMdContent: 'md', nowMs: 1000 },
      cache,
    )
    expect(r1.source).toBe('fallback')
    expect(deps.runRecallModel).toHaveBeenCalledTimes(1)

    const r2 = await findRelevantMemories(
      deps,
      { docs, recentText: 'q2', memoryMdContent: 'md', nowMs: 5000 },
      cache,
    )
    expect(deps.runRecallModel).toHaveBeenCalledTimes(1)
    expect(r2.source).toBe('cache')
  })

  test('findRelevantMemories makes fresh call after cooldown expires', async () => {
    const cache = new RecallCache(10_000)
    const docs = [makeDoc({ id: 'doc-1' })]

    const deps = makeDeps({
      runRecallModel: vi.fn(async () => ({
        ok: true,
        text: '["doc-1"]',
      })),
    })

    // First call at t=1000
    await findRelevantMemories(
      deps,
      { docs, recentText: 'q', memoryMdContent: 'md', nowMs: 1000 },
      cache,
    )

    // Second call at t=20000 — cooldown expired
    const result = await findRelevantMemories(
      deps,
      { docs, recentText: 'q2', memoryMdContent: 'md', nowMs: 20_000 },
      cache,
    )
    expect(deps.runRecallModel).toHaveBeenCalledTimes(2)
    expect(result.source).toBe('recall')
  })
})

// ---------------------------------------------------------------------------
// formatRecalledDocsBlock
// ---------------------------------------------------------------------------

describe('formatRecalledDocsBlock', () => {
  test('always includes MEMORY.md content', () => {
    const result: RecallResult = {
      selectedDocs: [],
      warnings: [],
      source: 'recall',
      memoryMdBlock: '# MEMORY.md\nIndex content here',
    }

    const block = formatRecalledDocsBlock(result)
    expect(block).toContain('MEMORY.md')
    expect(block).toContain('Index content here')
  })

  test('includes recalled doc details when present', () => {
    const result: RecallResult = {
      selectedDocs: [
        makeDoc({ title: 'Alice', type: 'character', description: 'A warrior' }),
      ],
      warnings: [],
      source: 'recall',
      memoryMdBlock: '# MEMORY.md',
    }

    const block = formatRecalledDocsBlock(result)
    expect(block).toContain('Alice')
    expect(block).toContain('A warrior')
  })

  test('includes freshness warnings', () => {
    const result: RecallResult = {
      selectedDocs: [],
      warnings: ['Memory "Old Event" may be outdated (marked as stale)'],
      source: 'recall',
      memoryMdBlock: '# MEMORY.md',
    }

    const block = formatRecalledDocsBlock(result)
    expect(block).toContain('outdated')
    expect(block).toContain('stale')
  })
})
