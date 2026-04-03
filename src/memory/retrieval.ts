import type { DirectorPluginState, MemdirDocument, OpenAIChat, RetrievalResult } from '../contracts/types.js'

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about',
  'this', 'that', 'these', 'those', 'i', 'me', 'my', 'myself', 'we',
  'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom',
])

const HIGH_PRIORITY_THRESHOLD = 0.4
const SCENE_MATCH_WEIGHT = 0.3
const RECENCY_WEIGHT = 0.3
const ENTITY_OVERLAP_WEIGHT = 0.3
const TEXT_OVERLAP_WEIGHT = 0.2
const DEFAULT_WORLD_FACT_RECENCY = 0.1

/** Tokenise text into lowercase significant words. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
}

interface Scorable {
  text: string
  sceneId?: string
  recencyWeight?: number
  entityIds?: string[]
}

function computeScore(
  item: Scorable,
  currentSceneId: string,
  messageTokens: ReadonlySet<string>,
): number {
  const sceneMatch = item.sceneId === currentSceneId ? SCENE_MATCH_WEIGHT : 0
  const recency = (item.recencyWeight ?? DEFAULT_WORLD_FACT_RECENCY) * RECENCY_WEIGHT

  let entityOverlap = 0
  if (item.entityIds && item.entityIds.length > 0) {
    const matched = item.entityIds.filter((id) => messageTokens.has(id.toLowerCase())).length
    entityOverlap = (matched / item.entityIds.length) * ENTITY_OVERLAP_WEIGHT
  }

  const itemTokens = tokenize(item.text)
  const textOverlap =
    itemTokens.length > 0
      ? (itemTokens.filter((t) => messageTokens.has(t)).length / itemTokens.length) *
        TEXT_OVERLAP_WEIGHT
      : 0

  return sceneMatch + recency + entityOverlap + textOverlap
}

export interface RetrieveMemoryInput {
  state: DirectorPluginState
  messages: OpenAIChat[]
}

/**
 * Deterministically retrieve and rank memory items against recent messages.
 *
 * - Continuity facts are unconditionally promoted to `mustInject`.
 * - Summaries and world facts are scored via scene-match, recency,
 *   entity-overlap, and text-overlap, then bucketed into
 *   `highPriority` (≥ threshold) or `opportunistic`.
 */
export function retrieveMemory({ state, messages }: RetrieveMemoryInput): RetrievalResult {
  const result: RetrievalResult = {
    mustInject: [],
    highPriority: [],
    opportunistic: [],
    scores: {},
  }

  // Continuity facts always go into mustInject
  for (const fact of state.director.continuityFacts) {
    result.mustInject.push(fact.text)
    result.scores[fact.id] = 1.0
  }

  const messageText = messages.map((m) => m.content).join(' ')
  const messageTokens = new Set(tokenize(messageText))
  const currentSceneId = state.director.currentSceneId

  // Score and bucket summaries
  for (const summary of state.memory.summaries) {
    const score = computeScore(summary, currentSceneId, messageTokens)
    result.scores[summary.id] = score
    if (score >= HIGH_PRIORITY_THRESHOLD) {
      result.highPriority.push(summary.text)
    } else {
      result.opportunistic.push(summary.text)
    }
  }

  // Score and bucket world facts
  for (const fact of state.memory.worldFacts) {
    const score = computeScore(fact, currentSceneId, messageTokens)
    result.scores[fact.id] = score
    if (score >= HIGH_PRIORITY_THRESHOLD) {
      result.highPriority.push(fact.text)
    } else {
      result.opportunistic.push(fact.text)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Memdir document keyword ranking (deterministic fallback for recall)
// ---------------------------------------------------------------------------

const DEFAULT_FALLBACK_MAX = 5

/**
 * Rank memdir documents by keyword overlap with the query text.
 * Used as a deterministic fallback when the recall model fails,
 * times out, or returns malformed output.
 */
export function rankDocsByKeywordOverlap(
  docs: MemdirDocument[],
  queryText: string,
  maxResults: number = DEFAULT_FALLBACK_MAX,
): MemdirDocument[] {
  if (docs.length === 0) return []

  const queryTokens = new Set(tokenize(queryText))

  // When query has no significant tokens, return newest docs up to limit
  if (queryTokens.size === 0) return docs.slice(0, maxResults)

  const scored = docs.map((doc) => {
    const docText = `${doc.title} ${doc.description} ${doc.tags.join(' ')}`
    const docTokens = tokenize(docText)
    const overlap = docTokens.filter((t) => queryTokens.has(t)).length
    const score = docTokens.length > 0 ? overlap / docTokens.length : 0
    return { doc, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, maxResults).map((s) => s.doc)
}
