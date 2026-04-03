import type { AsyncKeyValueStore } from '../contracts/risuai.js'
import type { DirectorPluginState } from '../contracts/types.js'
import { createEmptyState } from '../contracts/types.js'
import type { MemdirStore } from './memdirStore.js'
import { migrateCanonicalToMemdir } from './memoryDocuments.js'

export const DIRECTOR_STATE_STORAGE_KEY = 'director-plugin-state'

/**
 * Storage namespace for per-scope memdir migration markers.
 * Each scope stores `{MEMDIR_MIGRATION_MARKER_NS}:{scopeKey}`.
 */
export const MEMDIR_MIGRATION_MARKER_NS = 'director-memdir:migrated'

/** Schema version for the memdir-backed runtime. */
export const MEMDIR_SCHEMA_VERSION = 2

/**
 * Persisted marker indicating that a scope's canonical memory blob
 * has been successfully migrated into virtual memdir documents.
 */
export interface MemdirMigrationMarker {
  scopeKey: string
  migratedAt: number
  schemaVersion: number
  docCount: number
}

/**
 * Patch fields that may be absent in states persisted before the
 * continuityFacts migration. Mutates `state` in place.
 */
export function patchLegacyMemory(state: DirectorPluginState): void {
  if (!Array.isArray(state.memory.continuityFacts)) {
    if (Array.isArray(state.director.continuityFacts) && state.director.continuityFacts.length > 0) {
      state.memory.continuityFacts = structuredClone(state.director.continuityFacts)
    } else {
      state.memory.continuityFacts = []
    }
  }
  if (!Array.isArray(state.memory.worldFacts)) {
    state.memory.worldFacts = []
  }
  if (!Array.isArray(state.memory.entities)) {
    state.memory.entities = []
  }
  if (!Array.isArray(state.memory.relations)) {
    state.memory.relations = []
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

function migrationMarkerKey(scopeKey: string): string {
  return `${MEMDIR_MIGRATION_MARKER_NS}:${scopeKey}`
}

export interface CanonicalStoreOptions {
  /** Override the storage key. Defaults to {@link DIRECTOR_STATE_STORAGE_KEY}. */
  storageKey?: string
  /**
   * When `true` and the scoped key has no data, migrate from the legacy
   * flat key if data exists there. The legacy key is never deleted.
   */
  migrateFromFlatKey?: boolean
  /**
   * When provided, enables automatic lazy migration of canonical memory
   * into virtual memdir documents on first successful load per scope.
   * The canonical blob is never modified or deleted — reads remain
   * backward-compatible during and after migration.
   */
  memdirStore?: MemdirStore
}

export class CanonicalStore {
  private readonly storage: AsyncKeyValueStore
  private readonly storageKey: string
  private readonly migrateFromFlatKey: boolean
  private readonly memdirStore: MemdirStore | null
  private current: DirectorPluginState | null = null
  private migrationMarker: MemdirMigrationMarker | null = null

  constructor(storage: AsyncKeyValueStore, options?: CanonicalStoreOptions) {
    this.storage = storage
    this.storageKey = options?.storageKey ?? DIRECTOR_STATE_STORAGE_KEY
    this.migrateFromFlatKey =
      options?.migrateFromFlatKey === true &&
      this.storageKey !== DIRECTOR_STATE_STORAGE_KEY
    this.memdirStore = options?.memdirStore ?? null
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

  /**
   * Read the persisted migration marker for this scope, or `null`
   * if memdir migration has not been completed (or no memdirStore).
   */
  async getMigrationMarker(): Promise<MemdirMigrationMarker | null> {
    if (this.migrationMarker != null) return this.migrationMarker
    if (this.memdirStore == null) return null

    const raw = await this.storage.getItem<MemdirMigrationMarker>(
      migrationMarkerKey(this.memdirStore.scopeKey),
    )
    if (raw != null && typeof raw === 'object' && typeof raw.scopeKey === 'string') {
      this.migrationMarker = raw
      return raw
    }
    return null
  }

  async load(): Promise<DirectorPluginState> {
    const raw = await this.storage.getItem<unknown>(this.storageKey)
    if (isValidState(raw)) {
      this.current = structuredClone(raw)
      patchLegacyMemory(this.current)
      await this.tryMemdirMigration()
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
        await this.tryMemdirMigration()
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

  // ── Private: memdir migration ───────────────────────────────────────

  /**
   * Lazily migrate canonical memory into memdir on first successful load.
   * The migration is idempotent and non-destructive: the canonical blob
   * is never modified, and a per-scope marker prevents re-migration.
   */
  private async tryMemdirMigration(): Promise<void> {
    if (this.memdirStore == null || this.current == null) return

    // Check for existing migration marker
    const existing = await this.getMigrationMarker()
    if (existing != null) return

    // Run the migration
    try {
      const result = await migrateCanonicalToMemdir(this.current, this.memdirStore)

      // Persist the migration marker only after documents are written
      const marker: MemdirMigrationMarker = {
        scopeKey: this.memdirStore.scopeKey,
        migratedAt: Date.now(),
        schemaVersion: MEMDIR_SCHEMA_VERSION,
        docCount: result.migratedCount,
      }
      await this.storage.setItem(
        migrationMarkerKey(this.memdirStore.scopeKey),
        marker,
      )
      this.migrationMarker = marker
    } catch {
      // Migration failure is non-fatal — canonical reads remain available.
      // The marker is not set, so migration will be retried on next load.
    }
  }
}
