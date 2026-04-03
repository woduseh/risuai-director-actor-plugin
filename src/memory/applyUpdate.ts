import type {
  ArcState,
  DirectorPluginState,
  EntityMemory,
  MemoryOperation,
  MemorySummary,
  MemoryUpdate,
  RelationMemory,
  SceneBrief,
  ScenePhase,
  WorldFact
} from '../contracts/types.js'
import {
  upsertContinuityFact as mutUpsertContinuityFact,
  deleteContinuityFact as mutDeleteContinuityFact
} from './memoryMutations.js'

const MAX_FAILURE_HISTORY = 50
const MAX_SCENE_LEDGER = 200

export interface ApplyMemoryUpdateInput {
  turnId: string
  userText: string
  actorText: string
  brief: SceneBrief
}

export interface ApplyMemoryUpdateResult {
  state: DirectorPluginState
  warnings: string[]
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => entry != null)
}

function isScenePhase(value: string | undefined): value is ScenePhase {
  return value === 'setup' || value === 'pressure' || value === 'turn' || value === 'aftermath'
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function upsertSummary(
  summaries: MemorySummary[],
  text: string,
  now: number,
  partial?: Partial<MemorySummary>
): void {
  const existing = summaries.find((entry) => entry.text === text || entry.id === partial?.id)
  if (existing) {
    existing.text = text
    if (partial?.sceneId !== undefined) {
      existing.sceneId = partial.sceneId
    }
    existing.recencyWeight = partial?.recencyWeight ?? Math.max(existing.recencyWeight, 1)
    existing.entityIds = uniqueStrings([
      ...(existing.entityIds ?? []),
      ...readStringArray(partial?.entityIds)
    ])
    existing.updatedAt = now
    return
  }

  const next: MemorySummary = {
    id: partial?.id ?? createId('summary'),
    text,
    recencyWeight: partial?.recencyWeight ?? 1,
    updatedAt: now
  }
  if (partial?.sceneId !== undefined) {
    next.sceneId = partial.sceneId
  }
  const entityIds = readStringArray(partial?.entityIds)
  if (entityIds.length > 0) {
    next.entityIds = entityIds
  }
  summaries.push(next)
}

function upsertWorldFact(
  worldFacts: WorldFact[],
  text: string,
  now: number,
  partial?: Partial<WorldFact>
): void {
  const existing = worldFacts.find((entry) => entry.text === text || entry.id === partial?.id)
  if (existing) {
    existing.text = text
    existing.tags = uniqueStrings([...(existing.tags ?? []), ...readStringArray(partial?.tags)])
    existing.updatedAt = now
    return
  }

  const next: WorldFact = {
    id: partial?.id ?? createId('world'),
    text,
    updatedAt: now
  }
  const tags = readStringArray(partial?.tags)
  if (tags.length > 0) {
    next.tags = tags
  }
  worldFacts.push(next)
}

function upsertContinuityFact(
  state: DirectorPluginState,
  text: string,
  _now: number,
  partial?: { id?: string; priority?: number; sceneId?: string; entityIds?: string[] }
): void {
  const input: Parameters<typeof mutUpsertContinuityFact>[1] = {
    text,
    priority: partial?.priority ?? 0.8
  }
  if (partial?.id != null) input.id = partial.id
  if (partial?.sceneId != null) input.sceneId = partial.sceneId
  if (partial?.entityIds != null) input.entityIds = partial.entityIds
  mutUpsertContinuityFact(state, input)
}

function upsertEntity(
  entities: EntityMemory[],
  payload: Record<string, unknown>,
  now: number,
  warnings: string[]
): void {
  const id = readString(payload.id)
  const name = readString(payload.name)
  if (!id && !name) {
    warnings.push('Ignored entity update without id or name.')
    return
  }

  const existing = entities.find((entry) => entry.id === id || entry.name === name)
  const facts = readStringArray(payload.facts)
  const tags = readStringArray(payload.tags)

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

function upsertRelation(
  relations: RelationMemory[],
  payload: Record<string, unknown>,
  now: number,
  warnings: string[]
): void {
  const id = readString(payload.id)
  const sourceId = readString(payload.sourceId)
  const targetId = readString(payload.targetId)
  const label = readString(payload.label)

  if (!id && (!sourceId || !targetId || !label)) {
    warnings.push('Ignored relation update without id or relation keys.')
    return
  }

  const existing = relations.find(
    (entry) =>
      entry.id === id ||
      (entry.sourceId === sourceId && entry.targetId === targetId && entry.label === label)
  )
  const facts = readStringArray(payload.facts)

  if (existing) {
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

function upsertArc(
  arcs: ArcState[],
  payload: Record<string, unknown>,
  warnings: string[]
): void {
  const id = readString(payload.id)
  const label = readString(payload.label)
  if (!id && !label) {
    warnings.push('Ignored active arc operation without id or label.')
    return
  }

  const existing = arcs.find((entry) => entry.id === id || entry.label === label)
  const weight = readNumber(payload.weight) ?? 1
  const status =
    payload.status === 'active' || payload.status === 'paused' || payload.status === 'resolved'
      ? payload.status
      : 'active'

  if (existing) {
    existing.label = label ?? existing.label
    existing.weight = weight
    existing.status = status
    return
  }

  arcs.push({
    id: id ?? createId('arc'),
    label: label ?? `arc-${arcs.length + 1}`,
    status,
    weight
  })
}

function removeByIdentity<T extends { id: string }>(
  entries: T[],
  payload: Record<string, unknown>,
  predicate?: (entry: T) => boolean
): boolean {
  const id = readString(payload.id)
  const index = entries.findIndex((entry) => entry.id === id || predicate?.(entry) === true)
  if (index === -1) return false
  entries.splice(index, 1)
  return true
}

function normalizeTarget(target: string): string {
  return target.replace(/[\s_-]+/g, '').toLowerCase()
}

function applyMemoryOperation(
  state: DirectorPluginState,
  operation: MemoryOperation,
  now: number,
  input: ApplyMemoryUpdateInput,
  warnings: string[]
): void {
  const payload = asRecord(operation.payload)
  if (!payload) {
    warnings.push(`Ignored memory operation "${operation.target}" because payload was not an object.`)
    return
  }

  const target = normalizeTarget(operation.target)
  const text = readString(payload.text)

  switch (target) {
    case 'summaries':
    case 'summary': {
      if (operation.op === 'drop') {
        if (
          !removeByIdentity(state.memory.summaries, payload, (entry) => entry.text === text)
        ) {
          warnings.push(`Could not drop summary "${text ?? payload.id ?? 'unknown'}".`)
        }
        return
      }

      if (operation.op === 'archive') {
        const summary = state.memory.summaries.find(
          (entry) => entry.id === payload.id || entry.text === text
        )
        if (!summary) {
          warnings.push(`Could not archive summary "${text ?? payload.id ?? 'unknown'}".`)
          return
        }
        state.memory.turnArchive.push({
          id: createId('archive'),
          summaryId: summary.id,
          sourceTurnIds: [input.turnId],
          createdAt: now
        })
        state.memory.summaries = state.memory.summaries.filter((entry) => entry.id !== summary.id)
        return
      }

      if (!text) {
        warnings.push('Ignored summary operation without text.')
        return
      }

      const summaryPartial: Partial<MemorySummary> = {}
      const summaryId = readString(payload.id)
      const summarySceneId = readString(payload.sceneId)
      const summaryRecencyWeight = readNumber(payload.recencyWeight)
      const summaryEntityIds = readStringArray(payload.entityIds)
      if (summaryId !== null) summaryPartial.id = summaryId
      if (summarySceneId !== null) summaryPartial.sceneId = summarySceneId
      if (summaryRecencyWeight !== null) {
        summaryPartial.recencyWeight = summaryRecencyWeight
      }
      if (summaryEntityIds.length > 0) {
        summaryPartial.entityIds = summaryEntityIds
      }

      upsertSummary(state.memory.summaries, text, now, {
        ...summaryPartial
      })
      return
    }

    case 'worldfacts':
    case 'worldfact': {
      if (operation.op === 'drop') {
        if (
          !removeByIdentity(state.memory.worldFacts, payload, (entry) => entry.text === text)
        ) {
          warnings.push(`Could not drop world fact "${text ?? payload.id ?? 'unknown'}".`)
        }
        return
      }

      if (!text) {
        warnings.push('Ignored world fact operation without text.')
        return
      }

      const worldFactPartial: Partial<WorldFact> = {}
      const worldFactId = readString(payload.id)
      const worldFactTags = readStringArray(payload.tags)
      if (worldFactId !== null) worldFactPartial.id = worldFactId
      if (worldFactTags.length > 0) worldFactPartial.tags = worldFactTags

      upsertWorldFact(state.memory.worldFacts, text, now, {
        ...worldFactPartial
      })
      return
    }

    case 'continuityfacts':
    case 'continuityfact': {
      if (operation.op === 'drop') {
        const dropId = readString(payload.id)
        if (dropId) {
          if (!mutDeleteContinuityFact(state, dropId)) {
            warnings.push(`Could not drop continuity fact "${dropId}".`)
          }
        } else if (text) {
          const dirIdx = state.director.continuityFacts.findIndex((e) => e.text === text)
          const memIdx = state.memory.continuityFacts.findIndex((e) => e.text === text)
          if (dirIdx === -1 && memIdx === -1) {
            warnings.push(`Could not drop continuity fact "${text}".`)
          }
          if (dirIdx !== -1) state.director.continuityFacts.splice(dirIdx, 1)
          if (memIdx !== -1) state.memory.continuityFacts.splice(memIdx, 1)
        } else {
          warnings.push('Could not drop continuity fact "unknown".')
        }
        return
      }

      if (!text) {
        warnings.push('Ignored continuity fact operation without text.')
        return
      }

      const continuityPartial: {
        id?: string
        priority?: number
        sceneId?: string
        entityIds?: string[]
      } = {}
      const continuityId = readString(payload.id)
      const continuityPriority = readNumber(payload.priority)
      const continuitySceneId = readString(payload.sceneId)
      const continuityEntityIds = readStringArray(payload.entityIds)
      if (continuityId !== null) continuityPartial.id = continuityId
      if (continuityPriority !== null) continuityPartial.priority = continuityPriority
      if (continuitySceneId !== null) continuityPartial.sceneId = continuitySceneId
      if (continuityEntityIds.length > 0) {
        continuityPartial.entityIds = continuityEntityIds
      }

      upsertContinuityFact(state, text, now, {
        ...continuityPartial
      })
      return
    }

    case 'entities':
    case 'entity':
      if (operation.op === 'drop') {
        if (
          !removeByIdentity(
            state.memory.entities,
            payload,
            (entry) => entry.name === readString(payload.name)
          )
        ) {
          warnings.push(`Could not drop entity "${readString(payload.name) ?? payload.id ?? 'unknown'}".`)
        }
        return
      }
      upsertEntity(state.memory.entities, payload, now, warnings)
      return

    case 'relations':
    case 'relation':
      if (operation.op === 'drop') {
        if (
          !removeByIdentity(state.memory.relations, payload, (entry) => {
            const sourceId = readString(payload.sourceId)
            const targetId = readString(payload.targetId)
            const label = readString(payload.label)
            return (
              entry.sourceId === sourceId &&
              entry.targetId === targetId &&
              entry.label === label
            )
          })
        ) {
          warnings.push(`Could not drop relation "${payload.id ?? 'unknown'}".`)
        }
        return
      }
      upsertRelation(state.memory.relations, payload, now, warnings)
      return

    case 'activearcs':
    case 'activearc':
      if (operation.op === 'drop') {
        if (
          !removeByIdentity(
            state.director.activeArcs,
            payload,
            (entry) => entry.label === readString(payload.label)
          )
        ) {
          warnings.push(`Could not drop active arc "${readString(payload.label) ?? payload.id ?? 'unknown'}".`)
        }
        return
      }
      upsertArc(state.director.activeArcs, payload, warnings)
      return

    default:
      warnings.push(`Unknown memory operation target "${operation.target}".`)
  }
}

export function applyMemoryUpdate(
  state: DirectorPluginState,
  update: MemoryUpdate,
  input: ApplyMemoryUpdateInput
): ApplyMemoryUpdateResult {
  const next = structuredClone(state)
  const warnings: string[] = []
  const now = Date.now()

  next.director.pacingMode = input.brief.pacing
  next.director.ensembleWeights = {
    ...next.director.ensembleWeights,
    ...input.brief.ensembleWeights
  }

  for (const lock of input.brief.continuityLocks) {
    upsertContinuityFact(next, lock, now, { sceneId: next.director.currentSceneId })
  }

  if (isScenePhase(update.sceneDelta.scenePhase)) {
    next.director.scenePhase = update.sceneDelta.scenePhase
  }

  for (const durableFact of uniqueStrings(update.durableFacts)) {
    upsertSummary(next.memory.summaries, durableFact, now, {
      sceneId: next.director.currentSceneId,
      recencyWeight: 1
    })
  }

  for (const worldChange of uniqueStrings(update.sceneDelta.worldStateChanges ?? [])) {
    upsertWorldFact(next.memory.worldFacts, worldChange, now)
  }

  next.memory.sceneLedger.push({
    id: input.turnId,
    sceneId: next.director.currentSceneId,
    userText: input.userText,
    actorText: input.actorText,
    createdAt: now
  })
  if (next.memory.sceneLedger.length > MAX_SCENE_LEDGER) {
    next.memory.sceneLedger = next.memory.sceneLedger.slice(-MAX_SCENE_LEDGER)
  }

  for (const entityUpdate of update.entityUpdates) {
    const payload = asRecord(entityUpdate)
    if (!payload) {
      warnings.push('Ignored non-object entity update.')
      continue
    }
    upsertEntity(next.memory.entities, payload, now, warnings)
  }

  for (const relationUpdate of update.relationUpdates) {
    const payload = asRecord(relationUpdate)
    if (!payload) {
      warnings.push('Ignored non-object relation update.')
      continue
    }
    upsertRelation(next.memory.relations, payload, now, warnings)
  }

  for (const operation of update.memoryOps) {
    applyMemoryOperation(next, operation, now, input, warnings)
  }

  if (update.violations.length > 0) {
    const severity: 'low' | 'medium' | 'high' =
      update.status === 'hard-fail'
        ? 'high'
        : update.status === 'soft-fail'
          ? 'medium'
          : 'low'
    next.director.failureHistory.unshift(
      ...update.violations.map((reason) => ({
        timestamp: now,
        reason,
        severity
      }))
    )
    next.director.failureHistory = next.director.failureHistory.slice(0, MAX_FAILURE_HISTORY)
  }

  if (update.correction) {
    next.actor.currentIntentHints = uniqueStrings([
      update.correction,
      ...next.actor.currentIntentHints
    ]).slice(0, 12)
  }

  return { state: next, warnings }
}
