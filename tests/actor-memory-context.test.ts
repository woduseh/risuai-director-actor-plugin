import { describe, test, expect } from 'vitest'
import {
  buildActorMemoryContext,
  ACTOR_MEMORY_TOKEN_BUDGET,
  type ActorMemoryContextInput,
} from '../src/adapter/actorMemoryContext.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(
  overrides?: Partial<ActorMemoryContextInput>,
): ActorMemoryContextInput {
  return {
    notebookBlock: '',
    recalledDocsBlock: '',
    memorySummaries: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe('buildActorMemoryContext', () => {
  test('returns empty string when all inputs are empty', () => {
    const result = buildActorMemoryContext(makeInput())
    expect(result).toBe('')
  })

  test('returns empty string when inputs are only whitespace', () => {
    const result = buildActorMemoryContext(
      makeInput({
        notebookBlock: '   ',
        recalledDocsBlock: '\n\n',
        memorySummaries: ['', '  '],
      }),
    )
    expect(result).toBe('')
  })

  test('includes Director Long Memory heading', () => {
    const result = buildActorMemoryContext(
      makeInput({ recalledDocsBlock: 'Some recalled docs content' }),
    )
    expect(result).toContain('Director Long Memory')
  })

  test('includes recalled docs section when present', () => {
    const result = buildActorMemoryContext(
      makeInput({ recalledDocsBlock: 'Entity X was last seen near the lake.' }),
    )
    expect(result).toContain('Entity X was last seen near the lake.')
  })

  test('includes notebook section when present', () => {
    const result = buildActorMemoryContext(
      makeInput({ notebookBlock: '### Current State\nCharacter is wounded.' }),
    )
    expect(result).toContain('Character is wounded.')
  })

  test('includes canonical summaries when present', () => {
    const result = buildActorMemoryContext(
      makeInput({
        memorySummaries: [
          'The kingdom fell during the third age.',
          'Aran pledged loyalty to the Order.',
        ],
      }),
    )
    expect(result).toContain('The kingdom fell during the third age.')
    expect(result).toContain('Aran pledged loyalty to the Order.')
  })

  test('omits sections that are empty', () => {
    const result = buildActorMemoryContext(
      makeInput({
        notebookBlock: 'Session notes here.',
        recalledDocsBlock: '',
        memorySummaries: [],
      }),
    )
    expect(result).toContain('Session notes here.')
    // Should not include recalled docs or summaries headings
    expect(result).not.toContain('Recalled Documents')
    expect(result).not.toContain('Canonical Summaries')
  })

  test('renders all three sections when all are populated', () => {
    const result = buildActorMemoryContext(
      makeInput({
        notebookBlock: 'Session state text.',
        recalledDocsBlock: 'Recalled document text.',
        memorySummaries: ['Summary line 1.'],
      }),
    )
    expect(result).toContain('Session state text.')
    expect(result).toContain('Recalled document text.')
    expect(result).toContain('Summary line 1.')
  })

  test('exports the token budget constant as 3072', () => {
    expect(ACTOR_MEMORY_TOKEN_BUDGET).toBe(3072)
  })

  // ── Budget enforcement ──────────────────────────────────────────────

  test('truncates output when content exceeds the token budget', () => {
    // 3072 tokens × 4 chars/token = 12288 chars max
    const maxChars = ACTOR_MEMORY_TOKEN_BUDGET * 4
    const hugeSummaries = Array.from({ length: 200 }, (_, i) =>
      `Summary entry ${i}: ${'x'.repeat(100)}`,
    )
    const result = buildActorMemoryContext(
      makeInput({
        notebookBlock: 'Short notebook.',
        recalledDocsBlock: 'Short recall.',
        memorySummaries: hugeSummaries,
      }),
    )
    expect(result.length).toBeLessThanOrEqual(maxChars + 100) // small fudge for final line
  })

  test('does not crash on extremely large single-section input', () => {
    const huge = 'A'.repeat(50_000)
    const result = buildActorMemoryContext(
      makeInput({ recalledDocsBlock: huge }),
    )
    const maxChars = ACTOR_MEMORY_TOKEN_BUDGET * 4
    expect(result.length).toBeLessThanOrEqual(maxChars + 100)
  })

  // ── Format quality ─────────────────────────────────────────────────

  test('does not produce excessive blank lines', () => {
    const result = buildActorMemoryContext(
      makeInput({
        notebookBlock: 'Notebook content\n\n\n\n',
        recalledDocsBlock: '',
        memorySummaries: ['A summary.'],
      }),
    )
    expect(result).not.toMatch(/\n{4,}/)
  })
})
