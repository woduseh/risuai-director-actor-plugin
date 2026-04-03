import type { CanonicalMemory, ContinuityFact } from './types.js'

/** Current scoped-memory schema version for forward migration. */
export const MEMORY_SCHEMA_VERSION = 1

// ── Scope identity types ──────────────────────────────────────────

export interface CharacterScopeIdentity {
  /** RisuAI character ID */
  chaId: string
  /** Character display name */
  name: string
  /** Deterministic fingerprint derived from chaId + normalized name */
  fingerprint: string
}

export interface ChatScopeIdentity {
  /** RisuAI chat ID, when the host provides one */
  chatId?: string
  /** Chat display name */
  name: string
  /** Deterministic fingerprint derived from chat metadata */
  fingerprint: string
}

// ── Scoped memory envelope ────────────────────────────────────────

export interface ScopedMemoryMeta {
  /** Schema version for forward migration */
  schemaVersion: number
  /** Monotonic revision counter (0 = freshly created) */
  revision: number
  /** Last-update epoch-ms timestamp */
  updatedAt: number
  /** Writer identity string for conflict detection */
  lastWriterId: string
  /** Character scope identity */
  character: CharacterScopeIdentity
  /** Chat scope identity */
  chat: ChatScopeIdentity
}

export interface ScopedMemoryEnvelope {
  meta: ScopedMemoryMeta
  memory: CanonicalMemory
}

export interface CreateEnvelopeInput {
  character: CharacterScopeIdentity
  chat: ChatScopeIdentity
  writerId: string
}

/** Create a fresh scoped-memory envelope with empty canonical memory. */
export function createScopedMemoryEnvelope(
  input: CreateEnvelopeInput
): ScopedMemoryEnvelope {
  const now = Date.now()
  return {
    meta: {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      revision: 0,
      updatedAt: now,
      lastWriterId: input.writerId,
      character: { ...input.character },
      chat: { ...input.chat }
    },
    memory: {
      summaries: [],
      entities: [],
      relations: [],
      worldFacts: [],
      sceneLedger: [],
      turnArchive: [],
      continuityFacts: []
    }
  }
}

// ── Scope registry ────────────────────────────────────────────────

export interface ScopeRegistryEntry {
  /** Stable generated scope ID */
  scopeId: string
  /** One or more fingerprints that alias to this scope */
  fingerprints: string[]
  /** Human-readable label */
  label?: string
  /** Creation epoch-ms */
  createdAt: number
  /** Last-update epoch-ms */
  updatedAt: number
}

export interface ScopeRegistry {
  entries: ScopeRegistryEntry[]
}

/** Create an empty scope registry. */
export function createScopeRegistry(): ScopeRegistry {
  return { entries: [] }
}

function generateScopeId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `sc-${ts}-${rand}`
}

/**
 * Register a fingerprint in the registry.
 * If the fingerprint is already known, returns its existing scopeId.
 * Otherwise creates a new entry and returns the new scopeId.
 */
export function registerFingerprint(
  registry: ScopeRegistry,
  fingerprint: string,
  label?: string
): string {
  const existing = registry.entries.find((e) =>
    e.fingerprints.includes(fingerprint)
  )
  if (existing) return existing.scopeId

  const now = Date.now()
  const entry: ScopeRegistryEntry = {
    scopeId: generateScopeId(),
    fingerprints: [fingerprint],
    createdAt: now,
    updatedAt: now
  }
  if (label !== undefined) {
    entry.label = label
  }
  registry.entries.push(entry)
  return entry.scopeId
}

/**
 * Resolve a fingerprint to its stable scopeId.
 * Returns `undefined` when the fingerprint is not registered.
 */
export function resolveScope(
  registry: ScopeRegistry,
  fingerprint: string
): string | undefined {
  return registry.entries.find((e) =>
    e.fingerprints.includes(fingerprint)
  )?.scopeId
}

/**
 * Alias an additional fingerprint to an existing scope entry.
 * Throws if the scopeId is not found. Idempotent if fingerprint already present.
 */
export function aliasFingerprint(
  registry: ScopeRegistry,
  scopeId: string,
  fingerprint: string
): void {
  const entry = registry.entries.find((e) => e.scopeId === scopeId)
  if (!entry) {
    throw new Error(`Scope ID "${scopeId}" not found in registry`)
  }
  if (!entry.fingerprints.includes(fingerprint)) {
    entry.fingerprints.push(fingerprint)
    entry.updatedAt = Date.now()
  }
}
