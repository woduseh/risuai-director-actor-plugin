import type { AsyncKeyValueStore } from '../contracts/risuai.js'
import type { DirectorPluginState } from '../contracts/types.js'
import { createEmptyState } from '../contracts/types.js'

export const DIRECTOR_STATE_STORAGE_KEY = 'director-plugin-state'

/**
 * Patch fields that may be absent in states persisted before the
 * continuityFacts migration. Mutates `state` in place.
 */
function patchLegacyMemory(state: DirectorPluginState): void {
  if (!Array.isArray(state.memory.continuityFacts)) {
    if (Array.isArray(state.director.continuityFacts) && state.director.continuityFacts.length > 0) {
      state.memory.continuityFacts = structuredClone(state.director.continuityFacts)
    } else {
      state.memory.continuityFacts = []
    }
  }
}

/**
 * Validates that a value has the minimal shape of DirectorPluginState
 * to avoid undefined-property crashes at runtime.
 */
function isValidState(value: unknown): value is DirectorPluginState {
  if (value == null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.schemaVersion === 'number' &&
    typeof v.projectKey === 'string' &&
    typeof v.characterKey === 'string' &&
    typeof v.sessionKey === 'string' &&
    typeof v.updatedAt === 'number' &&
    v.settings != null && typeof v.settings === 'object' &&
    v.director != null && typeof v.director === 'object' &&
    v.actor != null && typeof v.actor === 'object' &&
    v.memory != null && typeof v.memory === 'object' &&
    v.metrics != null && typeof v.metrics === 'object'
  )
}

export class CanonicalStore {
  private readonly storage: AsyncKeyValueStore
  private current: DirectorPluginState | null = null

  constructor(storage: AsyncKeyValueStore) {
    this.storage = storage
  }

  snapshot(): DirectorPluginState {
    if (this.current == null) {
      throw new Error('CanonicalStore has not been loaded yet')
    }
    return structuredClone(this.current)
  }

  async load(): Promise<DirectorPluginState> {
    const raw = await this.storage.getItem<unknown>(DIRECTOR_STATE_STORAGE_KEY)
    if (isValidState(raw)) {
      this.current = structuredClone(raw)
      patchLegacyMemory(this.current)
    } else {
      this.current = createEmptyState()
    }
    return structuredClone(this.current)
  }

  async writeFirst(
    mutator: (state: DirectorPluginState) => DirectorPluginState | Promise<DirectorPluginState>,
    onAfterPersist?: () => void | Promise<void>
  ): Promise<DirectorPluginState> {
    if (this.current == null) {
      await this.load()
    }

    const next = await mutator(structuredClone(this.current!))

    next.updatedAt = Date.now()
    next.metrics.totalMemoryWrites += 1
    next.metrics.lastUpdatedAt = next.updatedAt

    const toStore = structuredClone(next)
    await this.storage.setItem(DIRECTOR_STATE_STORAGE_KEY, toStore)

    this.current = structuredClone(next)

    if (onAfterPersist) {
      await onAfterPersist()
    }

    return structuredClone(this.current)
  }
}
