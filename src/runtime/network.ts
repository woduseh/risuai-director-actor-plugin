/**
 * Lightweight network / hashing utilities for the extraction pipeline.
 *
 * Provides a fast, deterministic content hash for duplicate-request
 * detection without requiring crypto dependencies, plus host-safe
 * recall model routing.
 */

import type { ExtractionContext } from '../memory/extractMemories.js'
import type { RisuaiApi } from '../contracts/risuai.js'
import type { OpenAIChat } from '../contracts/types.js'

// ---------------------------------------------------------------------------
// FNV-1a 32-bit hash (fast, deterministic, no crypto dependency)
// ---------------------------------------------------------------------------

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

/**
 * Compute a fast FNV-1a 32-bit hash of the given string.
 * Returns a hex-encoded string.
 */
export function fnv1aHash(input: string): string {
  let hash = FNV_OFFSET
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Build a deterministic hash key for an extraction context.
 * Uses turnId + content prefix + message count to avoid collisions
 * while keeping computation fast.
 */
export function hashExtractionContext(ctx: ExtractionContext): string {
  const contentPrefix = ctx.content.slice(0, 200)
  const raw = `${ctx.turnId}|${ctx.type}|${ctx.messages.length}|${contentPrefix}`
  return fnv1aHash(raw)
}

// ---------------------------------------------------------------------------
// Recall model request — host-safe LLM routing
// ---------------------------------------------------------------------------

const RECALL_SYSTEM_PROMPT = [
  'You are a memory retrieval assistant for collaborative fiction.',
  'Given a manifest of memory documents (headers only) and recent conversation context,',
  'select the IDs of the most relevant documents.',
  '',
  'Rules:',
  '- Return ONLY a JSON array of document ID strings, e.g.: ["doc-1", "doc-3"]',
  '- Select only documents directly relevant to the current conversation',
  '- Prefer documents about active characters, ongoing plot points, or referenced world elements',
  '- If nothing is relevant, return an empty array: []',
].join('\n')

export interface RecallModelResponse {
  ok: boolean
  text: string
}

export interface RecallRequestOptions {
  model?: string
  mode?: string
}

/**
 * Route a memory recall request through the host-safe `runLLMModel`
 * abstraction. Never uses raw browser `fetch`.
 */
export async function makeRecallRequest(
  api: Pick<RisuaiApi, 'runLLMModel'>,
  manifest: string,
  recentText: string,
  options?: RecallRequestOptions,
): Promise<RecallModelResponse> {
  const messages: OpenAIChat[] = [
    { role: 'system', content: RECALL_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `## Memory Manifest\n${manifest}\n\n## Recent Conversation\n${recentText}`,
    },
  ]

  const result = await api.runLLMModel({
    messages,
    ...(options?.model ? { staticModel: options.model } : {}),
    mode: options?.mode ?? 'otherAx',
  })

  if (result.type === 'fail') {
    return { ok: false, text: result.result }
  }

  return { ok: true, text: result.result }
}
