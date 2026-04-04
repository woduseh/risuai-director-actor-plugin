import type {
  OpenAIChat,
  PromptFamily,
  PromptSegment,
  PromptSegmentKind,
  PromptTopology
} from '../contracts/types.js'

// ---------------------------------------------------------------------------
// Content-matching patterns (prompt-family-agnostic)
// ---------------------------------------------------------------------------

const AUTHOR_NOTE_PATTERN =
  /(?:^|\[)\s*author(?:'s)?\s*note\s*[\]:]|<author[_-]?note>/i

const CONSTRAINT_KEYWORDS =
  /\b(?:you\s+must|must\s+not|must\s+never|always\s+(?:stay|keep|remain|be)|never\s+(?:break|reveal|mention|use)|do\s+not|don't|forbidden|prohibited|under\s+no\s+circumstances|important\s*:\s*(?:do\s+not|never))\b/i

const OUTPUT_FORMAT_PATTERN =
  /\b(?:respond\s+(?:in|with|using)\s+(?:json|xml|yaml|markdown|csv)|format\s*:|output\s+format|schema\s*:|structured\s+(?:output|response))\b/i

const PERSONA_PATTERN =
  /(?:\bcharacter\s*:|{{char}}|\bpersona\s*:|\bplay\s+(?:the\s+)?(?:role|part)\s+of\b)/i

const LOREBOOK_PATTERN =
  /(?:\[world\s*info\]|\[lore(?:book)?\]|\bworld\s*info\s*:|lore\s*entry\s*:)/i

const MEMORY_PATTERN =
  /(?:\[(?:(?:past\s+)?summary|recap|memory|context)\b|summary\s+of\s+(?:past|previous|recent)|chat\s+(?:history|summary)|previously\s+(?:on|in))/i

const STYLE_REGISTER_PATTERN =
  /\b(?:writing\s+style|narrative\s+(?:style|voice|tone)|register\s*:|prose\s+style|stylistic\s+(?:guidance|direction)|tone\s*:|voice\s*:)\b/i

const CHARACTER_RULES_PATTERN =
  /\b(?:character\s+rules|behavior(?:al)?\s+(?:rules|guidelines)|{{char}}\s+(?:must|should|will|always|never))\b/i

const PREFILL_MAX_LENGTH = 20

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface KindScore {
  kind: PromptSegmentKind
  score: number
}

// ---------------------------------------------------------------------------
// Content-based heuristic scorer
// ---------------------------------------------------------------------------

function scoreContentHeuristics(content: string): KindScore[] {
  const scores: KindScore[] = []

  if (AUTHOR_NOTE_PATTERN.test(content)) {
    scores.push({ kind: 'author-note', score: 0.95 })
  }
  if (CONSTRAINT_KEYWORDS.test(content)) {
    scores.push({ kind: 'constraint', score: 0.8 })
  }
  if (OUTPUT_FORMAT_PATTERN.test(content)) {
    scores.push({ kind: 'output-format', score: 0.85 })
  }
  if (PERSONA_PATTERN.test(content)) {
    scores.push({ kind: 'persona', score: 0.75 })
  }
  if (LOREBOOK_PATTERN.test(content)) {
    scores.push({ kind: 'lorebook', score: 0.8 })
  }
  if (MEMORY_PATTERN.test(content)) {
    scores.push({ kind: 'memory', score: 0.8 })
  }
  if (STYLE_REGISTER_PATTERN.test(content)) {
    scores.push({ kind: 'style-register', score: 0.75 })
  }
  if (CHARACTER_RULES_PATTERN.test(content)) {
    scores.push({ kind: 'character-rules', score: 0.7 })
  }

  return scores
}

// ---------------------------------------------------------------------------
// Position-based heuristic scorer
// ---------------------------------------------------------------------------

function scorePositionHeuristics(
  role: OpenAIChat['role'],
  index: number,
  _totalCount: number,
  isLastUser: boolean,
  isLastAssistant: boolean,
  isTrailingAssistant: boolean,
  contentLength: number
): KindScore[] {
  const scores: KindScore[] = []

  if (role === 'system' && index === 0) {
    scores.push({ kind: 'system-canon', score: 0.85 })
  }

  if (isTrailingAssistant && contentLength <= PREFILL_MAX_LENGTH) {
    scores.push({ kind: 'prefill', score: 0.9 })
  }

  if (isLastUser) {
    scores.push({ kind: 'latest-user', score: 1.0 })
  } else if (role === 'user') {
    scores.push({ kind: 'conversation', score: 0.7 })
  }

  if (isLastAssistant && !isTrailingAssistant) {
    scores.push({ kind: 'latest-assistant', score: 1.0 })
  } else if (role === 'assistant' && !isTrailingAssistant) {
    scores.push({ kind: 'conversation', score: 0.7 })
  }

  return scores
}

// ---------------------------------------------------------------------------
// Merge & pick winner
// ---------------------------------------------------------------------------

function pickBestKind(
  positionScores: KindScore[],
  contentScores: KindScore[]
): { kind: PromptSegmentKind; confidence: number } {
  const merged = new Map<PromptSegmentKind, number>()

  for (const { kind, score } of positionScores) {
    merged.set(kind, Math.max(merged.get(kind) ?? 0, score))
  }
  for (const { kind, score } of contentScores) {
    const existing = merged.get(kind) ?? 0
    merged.set(kind, Math.min(1.0, existing + score))
  }

  // Positional overrides that always win when present
  const positionalOverrides: PromptSegmentKind[] = [
    'latest-user',
    'latest-assistant',
    'prefill'
  ]
  for (const override of positionalOverrides) {
    if (merged.has(override)) {
      return { kind: override, confidence: merged.get(override)! }
    }
  }

  let bestKind: PromptSegmentKind = 'unknown'
  let bestScore = 0
  for (const [kind, score] of merged) {
    if (score > bestScore) {
      bestScore = score
      bestKind = kind
    }
  }

  return {
    kind: bestKind,
    confidence: Math.round(bestScore * 100) / 100
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a single message segment by position and content heuristics.
 *
 * @param message    The chat message to classify
 * @param index      Zero-based position in the message array
 * @param totalCount Total number of messages
 * @param allMessages Optional full array for latest-user/assistant detection
 */
export function classifySegment(
  message: OpenAIChat,
  index: number,
  totalCount: number,
  allMessages?: readonly OpenAIChat[]
): PromptSegment {
  if (message.__directorInjected) {
    return { index, message, kind: 'director-like', confidence: 1.0 }
  }

  const { role, content } = message

  let isLastUser = false
  let isLastAssistant = false
  const isTrailingAssistant = role === 'assistant' && index === totalCount - 1

  if (allMessages) {
    let lastUserIdx = -1
    let lastAssistantIdx = -1
    for (let i = allMessages.length - 1; i >= 0; i--) {
      if (allMessages[i]!.role === 'user' && lastUserIdx === -1) {
        lastUserIdx = i
      }
      if (allMessages[i]!.role === 'assistant' && lastAssistantIdx === -1) {
        const isPrefillCandidate =
          i === allMessages.length - 1 &&
          allMessages[i]!.content.length <= PREFILL_MAX_LENGTH
        if (!isPrefillCandidate) {
          lastAssistantIdx = i
        }
      }
      if (lastUserIdx !== -1 && lastAssistantIdx !== -1) break
    }
    isLastUser = index === lastUserIdx
    isLastAssistant = index === lastAssistantIdx
  }

  const contentScores =
    role === 'system' ? scoreContentHeuristics(content) : []
  const positionScores = scorePositionHeuristics(
    role,
    index,
    totalCount,
    isLastUser,
    isLastAssistant,
    isTrailingAssistant,
    content.length
  )

  const { kind, confidence } = pickBestKind(positionScores, contentScores)

  return { index, message, kind, confidence }
}

/**
 * Build a complete prompt topology from an ordered message array.
 * Deterministic: same input always yields same output.
 */
export function buildTopology(messages: readonly OpenAIChat[]): PromptTopology {
  const segments: PromptSegment[] = messages.map((m, i) =>
    classifySegment(m, i, messages.length, messages)
  )

  let authorNoteIndex: number | null = null
  let latestUserIndex: number | null = null
  let latestAssistantIndex: number | null = null
  let constraintIndex: number | null = null
  let memoryIndex: number | null = null
  let hasPrefill = false

  for (const seg of segments) {
    switch (seg.kind) {
      case 'author-note':
        if (authorNoteIndex === null) authorNoteIndex = seg.index
        break
      case 'latest-user':
        latestUserIndex = seg.index
        break
      case 'latest-assistant':
        latestAssistantIndex = seg.index
        break
      case 'constraint':
        constraintIndex = seg.index
        break
      case 'memory':
        memoryIndex = seg.index
        break
      case 'prefill':
        hasPrefill = true
        break
    }
  }

  const confidence =
    segments.length > 0
      ? Math.round(
          (segments.reduce((acc, s) => acc * s.confidence, 1) **
            (1 / segments.length)) *
            100
        ) / 100
      : 0

  return {
    family: detectFamily(messages),
    confidence,
    segments,
    authorNoteIndex,
    latestUserIndex,
    latestAssistantIndex,
    constraintIndex,
    memoryIndex,
    hasPrefill
  }
}

/**
 * Check whether injecting a director brief adjacent to an author-note is safe.
 * Safe when an author-note exists and precedes the latest user message.
 */
export function isAuthorNoteInjectionSafe(topology: PromptTopology): boolean {
  if (topology.authorNoteIndex === null || topology.latestUserIndex === null) {
    return false
  }
  return topology.authorNoteIndex < topology.latestUserIndex
}

/**
 * Classify all messages (legacy helper kept for backward compatibility).
 */
export function classifyAllSegments(
  messages: readonly OpenAIChat[]
): PromptSegment[] {
  return buildTopology(messages).segments
}

// ---------------------------------------------------------------------------
// Family detection (extensible, currently conservative)
// ---------------------------------------------------------------------------

function detectFamily(messages: readonly OpenAIChat[]): PromptFamily {
  for (const m of messages) {
    if (m.role !== 'system') continue
    if (/\bmythos\b/i.test(m.content)) return 'mythos'
  }
  return 'unknown'
}
