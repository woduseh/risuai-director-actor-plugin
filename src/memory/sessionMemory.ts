// ---------------------------------------------------------------------------
// Session Memory Notebook
//
// A lightweight, within-session continuity layer inspired by Claude Code's
// CLAUDE.md notebook pattern.  The notebook holds structured sections that
// summarise the live session state and is projected into Director prompt
// assembly *before* opportunistic long-term memory summaries — giving the
// Director stable short-term context even when retrieval budgets change.
//
// The notebook is NOT a compaction target.  It is the last thing to be
// trimmed, not the first.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Section taxonomy (mirrors Claude Code's notebook categories)
// ---------------------------------------------------------------------------

export const NOTEBOOK_SECTIONS = [
  'currentState',
  'immediateGoals',
  'recentDevelopments',
  'unresolvedThreads',
  'recentMistakes',
] as const

export type NotebookSection = (typeof NOTEBOOK_SECTIONS)[number]

/** Human-readable labels used when rendering the notebook block. */
const SECTION_LABELS: Record<NotebookSection, string> = {
  currentState: 'Current State',
  immediateGoals: 'Immediate Goals',
  recentDevelopments: 'Important Recent Developments',
  unresolvedThreads: 'Unresolved Threads',
  recentMistakes: 'Recent Mistakes / Constraints',
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export interface SessionNotebookOptions {
  /** Minimum finalized turns before the notebook accepts an update. */
  turnThreshold: number
  /** Token-estimate accumulation that short-circuits the turn threshold. */
  tokenThreshold: number
}

export const DEFAULT_NOTEBOOK_THRESHOLDS: Readonly<SessionNotebookOptions> = {
  turnThreshold: 3,
  tokenThreshold: 500,
}

// ---------------------------------------------------------------------------
// Snapshot type
// ---------------------------------------------------------------------------

export type NotebookSnapshot = Readonly<Record<NotebookSection, string>>

// ---------------------------------------------------------------------------
// SessionNotebook
// ---------------------------------------------------------------------------

export class SessionNotebook {
  readonly scopeKey: string

  private readonly opts: SessionNotebookOptions
  private sections: Record<NotebookSection, string>
  private _turnsSinceUpdate = 0
  private _tokensSinceUpdate = 0

  constructor(scopeKey: string, opts?: Partial<SessionNotebookOptions>) {
    this.scopeKey = scopeKey
    this.opts = { ...DEFAULT_NOTEBOOK_THRESHOLDS, ...opts }
    this.sections = Object.fromEntries(
      NOTEBOOK_SECTIONS.map((s) => [s, '']),
    ) as Record<NotebookSection, string>
  }

  // ── Accessors ───────────────────────────────────────────────────────

  get turnsSinceUpdate(): number {
    return this._turnsSinceUpdate
  }

  get tokensSinceUpdate(): number {
    return this._tokensSinceUpdate
  }

  /** Return a frozen copy of the current section contents. */
  snapshot(): NotebookSnapshot {
    return Object.freeze({ ...this.sections })
  }

  // ── Turn tracking ───────────────────────────────────────────────────

  /** Record a finalized turn with an estimated token count. */
  recordTurn(estimatedTokens: number): void {
    this._turnsSinceUpdate += 1
    this._tokensSinceUpdate += estimatedTokens
  }

  // ── Threshold-gated update ──────────────────────────────────────────

  /**
   * Attempt to update notebook sections.  The update is accepted only when
   * at least one threshold (turns or tokens) has been met since the last
   * successful update.
   *
   * Only the keys present in `patch` are overwritten; unmentioned sections
   * retain their previous values (merge semantics).
   *
   * @returns `true` if the update was accepted.
   */
  tryUpdate(patch: Partial<Record<NotebookSection, string>>): boolean {
    if (!this.meetsThreshold()) return false
    this.applyPatch(patch)
    this.resetCounters()
    return true
  }

  /** Write sections unconditionally, bypassing all thresholds. */
  forceUpdate(patch: Partial<Record<NotebookSection, string>>): void {
    this.applyPatch(patch)
    this.resetCounters()
  }

  // ── Internal ────────────────────────────────────────────────────────

  private meetsThreshold(): boolean {
    return (
      this._turnsSinceUpdate >= this.opts.turnThreshold ||
      this._tokensSinceUpdate >= this.opts.tokenThreshold
    )
  }

  private applyPatch(patch: Partial<Record<NotebookSection, string>>): void {
    for (const key of NOTEBOOK_SECTIONS) {
      if (patch[key] !== undefined) {
        this.sections[key] = patch[key]
      }
    }
  }

  private resetCounters(): void {
    this._turnsSinceUpdate = 0
    this._tokensSinceUpdate = 0
  }
}

// ---------------------------------------------------------------------------
// Formatting — produces the text block injected into the Director prompt
// ---------------------------------------------------------------------------

/**
 * Format a notebook snapshot into a markdown block suitable for prompt
 * injection.  Returns an empty string when all sections are empty so the
 * prompt assembly can skip the block entirely.
 */
export function formatNotebookBlock(snap: NotebookSnapshot): string {
  const lines: string[] = []
  for (const section of NOTEBOOK_SECTIONS) {
    const value = snap[section]
    if (value) {
      lines.push(`### ${SECTION_LABELS[section]}`)
      lines.push(value)
      lines.push('')
    }
  }
  if (lines.length === 0) return ''
  return `## Session Notebook\n${lines.join('\n').trimEnd()}`
}
