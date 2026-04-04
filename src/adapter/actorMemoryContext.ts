// ---------------------------------------------------------------------------
// Actor Memory Context Serializer
//
// Renders a compact, actor-visible long-memory context block from the same
// inputs the Director sees (notebook, recalled docs, canonical summaries).
// The output is plain text — not the Director JSON brief schema — so the
// actor LLM reads it as natural long-memory context.
//
// Budget: ACTOR_MEMORY_TOKEN_BUDGET tokens, enforced via a simple
// chars-per-token ratio (same approach as memoryDocuments.ts).
//
// This block is computed before the Director call and later injected as a
// separate actor-visible system message by the CBS-aware dual-injection path.
// ---------------------------------------------------------------------------

/** Rough chars-per-token estimate — mirrors memoryDocuments.ts. */
const CHARS_PER_TOKEN = 4

/** Dedicated token budget for the actor-visible memory context block. */
export const ACTOR_MEMORY_TOKEN_BUDGET = 3072

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export interface ActorMemoryContextInput {
  /** Pre-formatted session notebook block (from `formatNotebookBlock`). */
  notebookBlock: string
  /** Pre-formatted recalled docs / MEMORY.md block. */
  recalledDocsBlock: string
  /** Projected canonical memory summaries (plain text lines). */
  memorySummaries: string[]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type Section = readonly [heading: string, body: string]

function isBlank(text: string): boolean {
  return text.trim().length === 0
}

/**
 * Render labelled sections into a single text block, staying within the
 * character budget.  Sections whose body is empty/whitespace-only are
 * omitted entirely so the output stays clean.
 */
function renderBudgetedSections(
  sections: Section[],
  tokenBudget: number,
): string {
  const maxChars = tokenBudget * CHARS_PER_TOKEN
  const lines: string[] = []
  let charCount = 0

  for (const [heading, body] of sections) {
    if (isBlank(body)) continue

    const sectionHeader = `## ${heading}`
    const sectionBody = body.trimEnd()
    // +2 for the two newlines separating header and body
    const sectionCost = sectionHeader.length + 1 + sectionBody.length + 1

    if (charCount + sectionCost > maxChars) {
      // Try to fit a truncated version of this section
      const remaining = maxChars - charCount
      if (remaining > sectionHeader.length + 20) {
        lines.push(sectionHeader)
        const availableForBody = remaining - sectionHeader.length - 2
        lines.push(sectionBody.slice(0, Math.max(0, availableForBody)))
        lines.push('')
      }
      break
    }

    lines.push(sectionHeader)
    lines.push(sectionBody)
    lines.push('')
    charCount += sectionCost
  }

  return lines.join('\n').trimEnd()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a compact actor-visible memory context block.
 *
 * Returns an empty string when every input is empty/whitespace, which the
 * caller can use to skip injection entirely.
 */
export function buildActorMemoryContext(
  input: ActorMemoryContextInput,
): string {
  const summariesBody = input.memorySummaries
    .filter((s) => !isBlank(s))
    .join('\n')

  const hasContent =
    !isBlank(input.recalledDocsBlock) ||
    !isBlank(input.notebookBlock) ||
    !isBlank(summariesBody)

  if (!hasContent) return ''

  const rendered = renderBudgetedSections(
    [
      ['Recalled Documents', input.recalledDocsBlock],
      ['Session Notebook', input.notebookBlock],
      ['Canonical Summaries', summariesBody],
    ],
    ACTOR_MEMORY_TOKEN_BUDGET,
  )

  if (isBlank(rendered)) return ''

  // Collapse runs of 3+ blank lines into a single blank line
  const cleaned = rendered.replace(/\n{3,}/g, '\n\n')

  return `# Director Long Memory\n\n${cleaned}`
}
