import type {
  BriefPacing,
  MemoryOpKind,
  MemoryOperation,
  MemoryUpdate,
  SceneBeat,
  SceneBrief,
  ValidationStatus,
} from '../contracts/types.js'
import { repairParseObject } from '../runtime/jsonRepair.js'

// ── Error class ──────────────────────────────────────────────────────

export class ModelPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelPayloadError'
    // Restore prototype chain broken by extending built-ins
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ── Allowed enum values ──────────────────────────────────────────────

const BRIEF_PACING_VALUES: readonly string[] = [
  'breathe', 'steady', 'tight', 'accelerate',
] satisfies readonly BriefPacing[]

const VALIDATION_STATUS_VALUES: readonly string[] = [
  'pass', 'soft-fail', 'hard-fail',
] satisfies readonly ValidationStatus[]

const MEMORY_OP_VALUES: readonly string[] = [
  'insert', 'update', 'merge', 'archive', 'drop',
] satisfies readonly MemoryOpKind[]

// ── Helpers ──────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function requireString(obj: Record<string, unknown>, key: string, label: string): string {
  const v = obj[key]
  if (typeof v !== 'string') throw new ModelPayloadError(`${label}: expected string for "${key}"`)
  return v
}

function requireNumber(obj: Record<string, unknown>, key: string, label: string): number {
  const v = obj[key]
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new ModelPayloadError(`${label}: expected number for "${key}"`)
  }
  return v
}

function requireArray(obj: Record<string, unknown>, key: string, label: string): unknown[] {
  const v = obj[key]
  if (!Array.isArray(v)) throw new ModelPayloadError(`${label}: expected array for "${key}"`)
  return v
}

function requireStringArray(obj: Record<string, unknown>, key: string, label: string): string[] {
  const arr = requireArray(obj, key, label)
  for (let i = 0; i < arr.length; i++) {
    if (typeof arr[i] !== 'string') {
      throw new ModelPayloadError(`${label}: expected string at ${key}[${i}]`)
    }
  }
  return arr as string[]
}

function requireRecord(obj: Record<string, unknown>, key: string, label: string): Record<string, unknown> {
  const v = obj[key]
  if (!isRecord(v)) throw new ModelPayloadError(`${label}: expected object for "${key}"`)
  return v
}

function requireEnum(obj: Record<string, unknown>, key: string, allowed: readonly string[], label: string): string {
  const v = requireString(obj, key, label)
  if (!allowed.includes(v)) {
    throw new ModelPayloadError(`${label}: invalid "${key}" value "${v}"; expected one of: ${allowed.join(', ')}`)
  }
  return v
}

// ── Text pre-processing ─────────────────────────────────────────────

// Re-export for backwards compatibility (existing tests import from here)
export { stripMarkdownCodeFences } from '../runtime/jsonRepair.js'

/**
 * Parse a JSON object from `text`, tolerating:
 *  - markdown code fences
 *  - surrounding prose (lines before/after the JSON object)
 *  - CRLF line endings
 *  - smart/curly quotes
 *  - trailing commas before } or ]
 *
 * Throws `ModelPayloadError` if no valid JSON object can be extracted.
 */
export function parseJsonObject(text: string): Record<string, unknown> {
  if (!text.trim()) throw new ModelPayloadError('Empty input')

  const result = repairParseObject(text)
  if (result) return result

  throw new ModelPayloadError('Could not extract a JSON object from the model output')
}

// ── SceneBrief parser / validator ────────────────────────────────────

export function parseSceneBrief(text: string): SceneBrief {
  const raw = parseJsonObject(text)
  const L = 'SceneBrief'

  // confidence – number in [0, 1]
  const confidence = requireNumber(raw, 'confidence', L)
  if (confidence < 0 || confidence > 1) {
    throw new ModelPayloadError(`${L}: "confidence" must be between 0 and 1`)
  }

  // pacing – enum
  const pacing = requireEnum(raw, 'pacing', BRIEF_PACING_VALUES, L) as BriefPacing

  // beats – array of SceneBeat
  const rawBeats = requireArray(raw, 'beats', L)
  const beats: SceneBeat[] = rawBeats.map((b, i) => {
    if (!isRecord(b)) throw new ModelPayloadError(`${L}: beats[${i}] must be an object`)
    const goal = requireString(b, 'goal', `${L}.beats[${i}]`)
    const reason = requireString(b, 'reason', `${L}.beats[${i}]`)
    const beat: SceneBeat = { goal, reason }
    if (typeof b['targetCharacter'] === 'string') beat.targetCharacter = b['targetCharacter']
    if (typeof b['stakes'] === 'string') beat.stakes = b['stakes']
    return beat
  })

  // simple string arrays
  const continuityLocks = requireStringArray(raw, 'continuityLocks', L)
  const forbiddenMoves = requireStringArray(raw, 'forbiddenMoves', L)
  const memoryHints = requireStringArray(raw, 'memoryHints', L)

  // ensembleWeights – Record<string, number>
  const ewRaw = requireRecord(raw, 'ensembleWeights', L)
  const ensembleWeights: Record<string, number> = {}
  for (const [k, v] of Object.entries(ewRaw)) {
    if (typeof v !== 'number') throw new ModelPayloadError(`${L}: ensembleWeights["${k}"] must be a number`)
    ensembleWeights[k] = v
  }

  // styleInheritance – object with optional string fields
  const siRaw = requireRecord(raw, 'styleInheritance', L)
  const styleInheritance: SceneBrief['styleInheritance'] = {}
  for (const field of ['genre', 'register', 'language', 'pov'] as const) {
    const v = siRaw[field]
    if (typeof v === 'string') styleInheritance[field] = v
  }

  return {
    confidence,
    pacing,
    beats,
    continuityLocks,
    ensembleWeights,
    styleInheritance,
    forbiddenMoves,
    memoryHints,
  }
}

// ── MemoryUpdate parser / validator ──────────────────────────────────

export function parseMemoryUpdate(text: string): MemoryUpdate {
  const raw = parseJsonObject(text)
  const L = 'MemoryUpdate'

  const status = requireEnum(raw, 'status', VALIDATION_STATUS_VALUES, L) as ValidationStatus

  const turnScore = requireNumber(raw, 'turnScore', L)

  const violations = requireStringArray(raw, 'violations', L)
  const durableFacts = requireStringArray(raw, 'durableFacts', L)

  // sceneDelta
  const sdRaw = requireRecord(raw, 'sceneDelta', L)
  const sceneDelta: MemoryUpdate['sceneDelta'] = {}
  if (typeof sdRaw['scenePhase'] === 'string') sceneDelta.scenePhase = sdRaw['scenePhase']
  if (Array.isArray(sdRaw['activeCharacters'])) sceneDelta.activeCharacters = sdRaw['activeCharacters'] as string[]
  if (Array.isArray(sdRaw['worldStateChanges'])) sceneDelta.worldStateChanges = sdRaw['worldStateChanges'] as string[]

  // entityUpdates / relationUpdates – arrays of objects
  const entityUpdates = requireArray(raw, 'entityUpdates', L) as Record<string, unknown>[]
  const relationUpdates = requireArray(raw, 'relationUpdates', L) as Record<string, unknown>[]

  // memoryOps – array of MemoryOperation
  const rawOps = requireArray(raw, 'memoryOps', L)
  const memoryOps: MemoryOperation[] = rawOps.map((o, i) => {
    if (!isRecord(o)) throw new ModelPayloadError(`${L}: memoryOps[${i}] must be an object`)
    const op = requireEnum(o, 'op', MEMORY_OP_VALUES, `${L}.memoryOps[${i}]`) as MemoryOpKind
    const target = requireString(o, 'target', `${L}.memoryOps[${i}]`)
    const payload = requireRecord(o, 'payload', `${L}.memoryOps[${i}]`)
    return { op, target, payload }
  })

  const result: MemoryUpdate = {
    status,
    turnScore,
    violations,
    durableFacts,
    sceneDelta,
    entityUpdates,
    relationUpdates,
    memoryOps,
  }

  // optional field
  if (typeof raw['correction'] === 'string') {
    result.correction = raw['correction']
  }

  return result
}
