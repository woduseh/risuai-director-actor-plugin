/**
 * Reusable JSON repair / recovery layer for LLM outputs.
 *
 * Handles common malformed-but-recoverable JSON patterns:
 *   1. Markdown code fences (```json ... ```)
 *   2. Surrounding prose before/after the JSON payload
 *   3. Balanced object/array substring extraction
 *   4. Smart quotes / curly quotes normalization
 *   5. Trailing commas before } or ]
 *
 * Intentionally conservative — no YAML parsing, no eval, no deep repair.
 */

// ── Smart quote normalization ───────────────────────────────────────

/** Replace Unicode curly/smart quotes with ASCII equivalents. */
export function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"') // double curly/smart quotes
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'") // single curly/smart quotes
}

// ── Trailing comma removal ──────────────────────────────────────────

/** Remove trailing commas before closing } or ]. */
export function removeTrailingCommas(text: string): string {
  return text.replace(/,\s*([\]}])/g, '$1')
}

// ── Fence stripping ─────────────────────────────────────────────────

/**
 * Remove markdown code fences (``` or ```json) from around a JSON payload.
 * Also strips any prose lines outside the fenced block.
 */
export function stripMarkdownCodeFences(text: string): string {
  const normalised = text.replace(/\r\n/g, '\n')

  const fenceRe = /```[a-zA-Z]*\n([\s\S]*?)\n```/
  const m = fenceRe.exec(normalised)
  if (m) return m[1]!.trim()

  return normalised.trim()
}

// ── Balanced substring extraction ───────────────────────────────────

type JsonRootKind = 'object' | 'array'

const OPEN_CHAR: Record<JsonRootKind, string> = { object: '{', array: '[' }
const CLOSE_CHAR: Record<JsonRootKind, string> = { object: '}', array: ']' }

/**
 * Scan for the first balanced `{…}` or `[…]` substring via
 * bracket counting (respects JSON string escaping).
 * Returns the extracted substring or null.
 */
export function extractBalancedSubstring(
  text: string,
  kind: JsonRootKind,
): string | null {
  const open = OPEN_CHAR[kind]
  const close = CLOSE_CHAR[kind]

  const start = text.indexOf(open)
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }
  return null
}

// ── Core repair pipeline ────────────────────────────────────────────

/**
 * Apply a bounded sequence of safe transformations to `raw` text and
 * attempt `JSON.parse`.  Returns the parsed value or null.
 *
 * Pipeline order:
 *   1. Strip fences → try JSON.parse (pristine fast path)
 *   2. Normalize smart quotes → try JSON.parse
 *   3. Remove trailing commas → retry
 *   4. Extract balanced substring → retry (with trailing-comma removal)
 */
function attemptRepairedParse(raw: string): unknown | null {
  // Step 1: fence strip only — try parse before any text mutation
  const fenceStripped = stripMarkdownCodeFences(raw)
  const pristine = tryParse(fenceStripped)
  if (pristine !== undefined) return pristine

  // Step 2–3: quote normalize + fast path
  const stripped = normalizeQuotes(fenceStripped)
  const fast = tryParse(stripped)
  if (fast !== undefined) return fast

  // Step 4: trailing comma removal
  const detrailed = removeTrailingCommas(stripped)
  const afterDetrail = tryParse(detrailed)
  if (afterDetrail !== undefined) return afterDetrail

  // Step 5: extract balanced object or array from (possibly prose-wrapped) text
  const normalized = normalizeQuotes(raw.replace(/\r\n/g, '\n'))
  for (const kind of ['object', 'array'] as const) {
    const sub = extractBalancedSubstring(normalized, kind)
    if (sub) {
      const parsed = tryParse(sub)
      if (parsed !== undefined) return parsed
      const repairedSub = removeTrailingCommas(sub)
      const parsedRepaired = tryParse(repairedSub)
      if (parsedRepaired !== undefined) return parsedRepaired
    }
  }

  return null
}

function tryParse(s: string): unknown | undefined {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

// ── Public helpers ──────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Attempt to parse and repair an LLM response into a JSON **object**.
 * Returns the parsed Record or null if recovery fails.
 */
export function repairParseObject(raw: string): Record<string, unknown> | null {
  const parsed = attemptRepairedParse(raw)
  return isRecord(parsed) ? parsed : null
}

/**
 * Attempt to parse and repair an LLM response into a JSON **array**.
 * Returns the parsed array or null if recovery fails.
 */
export function repairParseArray(raw: string): unknown[] | null {
  const parsed = attemptRepairedParse(raw)
  return Array.isArray(parsed) ? parsed : null
}
