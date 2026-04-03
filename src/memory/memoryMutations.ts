/**
 * Typed mutation helpers for canonical memory state.
 *
 * Each helper mutates `DirectorPluginState` in place.
 * Continuity helpers keep `state.memory.continuityFacts` and
 * `state.director.continuityFacts` in sync.
 */
import type {
  ContinuityFact,
  DirectorPluginState,
  EntityMemory,
  MemorySummary,
  RelationMemory,
  WorldFact
} from '../contracts/types.js'

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))]
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export interface UpsertSummaryInput {
  id?: string
  text: string
  recencyWeight: number
  sceneId?: string
  entityIds?: string[]
}

export function upsertSummary(state: DirectorPluginState, input: UpsertSummaryInput): void {
  const now = Date.now()
  const { id, text, recencyWeight, sceneId, entityIds } = input
  const summaries = state.memory.summaries

  const existing = id ? summaries.find((s) => s.id === id) : undefined

  if (existing) {
    existing.text = text
    existing.recencyWeight = recencyWeight
    if (sceneId !== undefined) existing.sceneId = sceneId
    if (entityIds) {
      existing.entityIds = uniqueStrings([...(existing.entityIds ?? []), ...entityIds])
    }
    existing.updatedAt = now
    return
  }

  const entry: MemorySummary = {
    id: id ?? createId('summary'),
    text,
    recencyWeight,
    updatedAt: now
  }
  if (sceneId !== undefined) entry.sceneId = sceneId
  if (entityIds && entityIds.length > 0) entry.entityIds = entityIds
  summaries.push(entry)
}

export function deleteSummary(state: DirectorPluginState, id: string): boolean {
  const idx = state.memory.summaries.findIndex((s) => s.id === id)
  if (idx === -1) return false
  state.memory.summaries.splice(idx, 1)
  return true
}

// ---------------------------------------------------------------------------
// World Facts
// ---------------------------------------------------------------------------

export interface UpsertWorldFactInput {
  id?: string
  text: string
  tags?: string[]
}

export function upsertWorldFact(state: DirectorPluginState, input: UpsertWorldFactInput): void {
  const now = Date.now()
  const { id, text, tags } = input
  const worldFacts = state.memory.worldFacts

  const existing = id ? worldFacts.find((w) => w.id === id) : undefined

  if (existing) {
    existing.text = text
    if (tags) existing.tags = uniqueStrings([...(existing.tags ?? []), ...tags])
    existing.updatedAt = now
    return
  }

  const entry: WorldFact = {
    id: id ?? createId('world'),
    text,
    updatedAt: now
  }
  if (tags && tags.length > 0) entry.tags = tags
  worldFacts.push(entry)
}

export function deleteWorldFact(state: DirectorPluginState, id: string): boolean {
  const idx = state.memory.worldFacts.findIndex((w) => w.id === id)
  if (idx === -1) return false
  state.memory.worldFacts.splice(idx, 1)
  return true
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface UpsertEntityInput {
  id?: string
  name?: string
  facts?: string[]
  tags?: string[]
}

export function upsertEntity(state: DirectorPluginState, input: UpsertEntityInput): void {
  const now = Date.now()
  const { id, name, facts = [], tags = [] } = input
  const entities = state.memory.entities

  const existing = id
    ? entities.find((e) => e.id === id)
    : name
      ? entities.find((e) => e.name === name)
      : undefined

  if (existing) {
    if (name) existing.name = name
    existing.facts = uniqueStrings([...existing.facts, ...facts])
    existing.tags = uniqueStrings([...(existing.tags ?? []), ...tags])
    existing.updatedAt = now
    return
  }

  entities.push({
    id: id ?? createId('entity'),
    name: name ?? `entity-${entities.length + 1}`,
    facts,
    tags,
    updatedAt: now
  })
}

export function deleteEntity(state: DirectorPluginState, id: string): boolean {
  const idx = state.memory.entities.findIndex((e) => e.id === id)
  if (idx === -1) return false
  state.memory.entities.splice(idx, 1)
  return true
}

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export interface UpsertRelationInput {
  id?: string
  sourceId?: string
  targetId?: string
  label?: string
  facts?: string[]
}

export function upsertRelation(state: DirectorPluginState, input: UpsertRelationInput): void {
  const now = Date.now()
  const { id, sourceId, targetId, label, facts = [] } = input
  const relations = state.memory.relations

  const existing = id ? relations.find((r) => r.id === id) : undefined

  if (existing) {
    if (sourceId) existing.sourceId = sourceId
    if (targetId) existing.targetId = targetId
    if (label) existing.label = label
    existing.facts = uniqueStrings([...(existing.facts ?? []), ...facts])
    existing.updatedAt = now
    return
  }

  relations.push({
    id: id ?? createId('relation'),
    sourceId: sourceId ?? 'unknown-source',
    targetId: targetId ?? 'unknown-target',
    label: label ?? 'related',
    facts,
    updatedAt: now
  })
}

export function deleteRelation(state: DirectorPluginState, id: string): boolean {
  const idx = state.memory.relations.findIndex((r) => r.id === id)
  if (idx === -1) return false
  state.memory.relations.splice(idx, 1)
  return true
}

// ---------------------------------------------------------------------------
// Continuity Facts — dual sync between memory and director
// ---------------------------------------------------------------------------

export interface UpsertContinuityFactInput {
  id?: string
  text: string
  priority: number
  sceneId?: string
  entityIds?: string[]
}

export function upsertContinuityFact(
  state: DirectorPluginState,
  input: UpsertContinuityFactInput
): void {
  const { id, text, priority, sceneId, entityIds } = input
  let resolvedId = id

  function upsertInto(arr: ContinuityFact[]): void {
    const existing = id
      ? arr.find((f) => f.id === id)
      : arr.find((f) => f.text === text)

    if (existing) {
      if (!resolvedId) {
        resolvedId = existing.id
      } else if (existing.id !== resolvedId) {
        existing.id = resolvedId
      }
      existing.text = text
      existing.priority = priority
      if (sceneId !== undefined) existing.sceneId = sceneId
      if (entityIds) {
        existing.entityIds = uniqueStrings([...(existing.entityIds ?? []), ...entityIds])
      }
      return
    }

    if (!resolvedId) {
      resolvedId = createId('continuity')
    }

    const entry: ContinuityFact = { id: resolvedId, text, priority }
    if (sceneId !== undefined) entry.sceneId = sceneId
    if (entityIds && entityIds.length > 0) entry.entityIds = entityIds
    arr.push(entry)
  }

  upsertInto(state.memory.continuityFacts)
  upsertInto(state.director.continuityFacts)
}

export function deleteContinuityFact(state: DirectorPluginState, id: string): boolean {
  const memIdx = state.memory.continuityFacts.findIndex((f) => f.id === id)
  const dirIdx = state.director.continuityFacts.findIndex((f) => f.id === id)

  let removed = false
  if (memIdx !== -1) {
    state.memory.continuityFacts.splice(memIdx, 1)
    removed = true
  }
  if (dirIdx !== -1) {
    state.director.continuityFacts.splice(dirIdx, 1)
    removed = true
  }

  return removed
}
