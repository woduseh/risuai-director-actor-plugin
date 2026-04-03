/**
 * Lightweight network / hashing utilities for the extraction pipeline.
 *
 * Provides a fast, deterministic content hash for duplicate-request
 * detection without requiring crypto dependencies, plus host-safe
 * recall model routing and a reusable retry helper with exponential
 * backoff for transient failures.
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
// Transient error detection & retry with exponential backoff
// ---------------------------------------------------------------------------

const TRANSIENT_STATUS_CODES = [429, 502, 503, 504, 524]
const TRANSIENT_KEYWORDS = ['rate limit', 'timeout', 'overloaded']

const DEFAULT_MAX_RETRIES = 2
const DEFAULT_BASE_DELAY_MS = 1500

export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  isRetryable?: (error: unknown) => boolean
  log?: (message: string) => void
  signal?: AbortSignal
}

/**
 * Determine whether an error (or plain string) looks like a transient
 * failure that is worth retrying — e.g. 429, 502-504, 524, or common
 * rate-limit / timeout wording.
 */
export function isTransientError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase()

  for (const code of TRANSIENT_STATUS_CODES) {
    if (message.includes(String(code))) return true
  }
  for (const keyword of TRANSIENT_KEYWORDS) {
    if (message.includes(keyword)) return true
  }
  return false
}

/**
 * Execute `fn` with up to `maxRetries` retry attempts on transient
 * errors, using exponential backoff (base × 2^attempt).
 *
 * Non-retryable errors are re-thrown immediately.
 */
export function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const p = _withRetryImpl(fn, options)
  // Prevent transient unhandled-rejection when an abort signal cancels
  // the backoff before the caller's await/catch processes the rejection.
  if (options?.signal) p.catch(() => {})
  return p
}

async function _withRetryImpl<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const isRetryable = options?.isRetryable ?? isTransientError
  const log = options?.log
  const signal = options?.signal

  function throwIfAborted(): void {
    if (signal?.aborted) {
      const err = new Error('Retry aborted')
      err.name = 'AbortError'
      throw err
    }
  }

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    throwIfAborted()
    try {
      const result = await fn()
      throwIfAborted()
      return result
    } catch (err) {
      lastError = err
      if (attempt < maxRetries && isRetryable(err)) {
        const delay = baseDelayMs * Math.pow(2, attempt)
        if (log) {
          const msg = err instanceof Error ? err.message : String(err)
          log(`Retrying (${attempt + 1}/${maxRetries}) after ${delay}ms: ${msg}`)
        }
        await new Promise<void>((resolve) => {
          if (signal?.aborted) { resolve(); return }
          const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
          }, delay)
          function onAbort(): void {
            clearTimeout(timer)
            resolve()
          }
          signal?.addEventListener('abort', onAbort, { once: true })
        })
        continue
      }
      throw err
    }
  }
  // Unreachable — the loop always returns or throws
  throw lastError
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
