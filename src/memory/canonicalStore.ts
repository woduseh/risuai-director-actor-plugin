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
export function isValidState(value: unknown): value is DirectorPluginState {
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

export interface CanonicalStoreOptions {
  /** Override the storage key. Defaults to {@link DIRECTOR_STATE_STORAGE_KEY}. */
  storageKey?: string
  /**
   * When `true` and the scoped key has no data, migrate from the legacy
   * flat key if data exists there. The legacy key is never deleted.
   */
  migrateFromFlatKey?: boolean
}

export class CanonicalStore {
  private readonly storage: AsyncKeyValueStore
  private readonly storageKey: string
  private readonly migrateFromFlatKey: boolean
  private current: DirectorPluginState | null = null

  constructor(storage: AsyncKeyValueStore, options?: CanonicalStoreOptions) {
    this.storage = storage
    this.storageKey = options?.storageKey ?? DIRECTOR_STATE_STORAGE_KEY
    this.migrateFromFlatKey =
      options?.migrateFromFlatKey === true &&
      this.storageKey !== DIRECTOR_STATE_STORAGE_KEY
  }

  /** The storage key this store reads/writes. */
  get stateStorageKey(): string {
    return this.storageKey
  }

  snapshot(): DirectorPluginState {
    if (this.current == null) {
      throw new Error('CanonicalStore has not been loaded yet')
    }
    return structuredClone(this.current)
  }

  async load(): Promise<DirectorPluginState> {
    const raw = await this.storage.getItem<unknown>(this.storageKey)
    if (isValidState(raw)) {
      this.current = structuredClone(raw)
      patchLegacyMemory(this.current)
      return structuredClone(this.current)
    }

    // Attempt migration from the legacy flat key
    if (this.migrateFromFlatKey) {
      const legacy = await this.storage.getItem<unknown>(
        DIRECTOR_STATE_STORAGE_KEY,
      )
      if (isValidState(legacy)) {
        this.current = structuredClone(legacy)
        patchLegacyMemory(this.current)
        // Persist the migrated copy into the scoped key (do NOT delete flat key)
        await this.storage.setItem(
          this.storageKey,
          structuredClone(this.current),
        )
        return structuredClone(this.current)
      }
    }

    this.current = createEmptyState()
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
    await this.storage.setItem(this.storageKey, toStore)

    this.current = structuredClone(next)

    if (onAfterPersist) {
      await onAfterPersist()
    }

    return structuredClone(this.current)
  }
}
