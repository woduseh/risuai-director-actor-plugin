import type { AsyncKeyValueStore } from '../contracts/risuai.js'
import type {
  DirectorPromptPreset,
  DirectorSettings,
  DirectorPluginState,
  StoredDirectorPromptPreset,
  CanonicalMemory,
  EmbeddingCacheStatus,
} from '../contracts/types.js'
import { DEFAULT_DIRECTOR_SETTINGS } from '../contracts/types.js'

// Re-export so existing consumers that import from this module keep working.
export type { EmbeddingCacheStatus } from '../contracts/types.js'
import type { DiagnosticsSnapshot } from '../runtime/diagnostics.js'
import { createDefaultDiagnosticsSnapshot } from '../runtime/diagnostics.js'
import {
  BUILTIN_PROMPT_PRESET_ID,
  BUILTIN_PROMPT_PRESET_NAME,
  DEFAULT_DIRECTOR_PROMPT_PRESET,
  resolvePromptPreset,
} from '../director/prompt.js'
import { t } from './i18n.js'

// ---------------------------------------------------------------------------
// Storage keys & schema version
// ---------------------------------------------------------------------------

export const DASHBOARD_SETTINGS_KEY = 'continuity-director-dashboard-settings-v1'
export const DASHBOARD_PROFILE_MANIFEST_KEY = 'continuity-director-dashboard-profile-manifest-v1'
export const DASHBOARD_LOCALE_KEY = 'continuity-director-dashboard-locale-v1'
export const DASHBOARD_LAST_TAB_KEY = 'continuity-director-dashboard-last-tab-v1'
export const DASHBOARD_SCHEMA_VERSION = 1

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardDraft {
  isDirty: boolean
  settings: DirectorSettings
}

export interface DashboardProfile {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  basedOn: string | null
  overrides: Partial<DirectorSettings>
}

export interface ProfileManifest {
  version: number
  activeProfileId: string
  profiles: DashboardProfile[]
}

export interface ProfileExportPayload {
  schema: string
  version: number
  profile: DashboardProfile
}

export interface SettingsExportPayload {
  schema: 'continuity-director-dashboard-settings'
  version: 1
  exportedAt: number
  locale: import('./i18n.js').DashboardLocale
  settings: DirectorSettings
  profiles: ProfileManifest
}

interface PersistedProfileManifestLike {
  version?: unknown
  activeProfileId?: unknown
  profiles?: unknown
}

interface PersistedPromptPresetLike {
  id?: unknown
  name?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  preset?: unknown
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Merge a (possibly incomplete) persisted settings blob with
 * DEFAULT_DIRECTOR_SETTINGS so every field is guaranteed present.
 */
export function normalizePersistedSettings(
  raw: Partial<DirectorSettings>
): DirectorSettings {
  return {
    ...DEFAULT_DIRECTOR_SETTINGS,
    ...raw,
    promptPresetId:
      typeof raw.promptPresetId === 'string'
        ? raw.promptPresetId
        : DEFAULT_DIRECTOR_SETTINGS.promptPresetId,
    promptPresets: normalizePromptPresets(raw.promptPresets),
  }
}

function parseStoredValue<T>(value: unknown): T | null {
  if (value == null) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }
  return value as T
}

// ---------------------------------------------------------------------------
// Draft wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap a normalized settings object in a draft envelope.
 * `isDirty` starts as `false` — callers flip it when the user edits a field.
 */
export function createDashboardDraft(settings: DirectorSettings): DashboardDraft {
  return {
    isDirty: false,
    settings: { ...settings },
  }
}

function isValidPromptPreset(value: unknown): value is DirectorPromptPreset {
  if (value == null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const directives = record.assertivenessDirectives
  if (directives == null || typeof directives !== 'object') return false
  const directiveRecord = directives as Record<string, unknown>

  return (
    typeof record.preRequestSystemTemplate === 'string' &&
    typeof record.preRequestUserTemplate === 'string' &&
    typeof record.postResponseSystemTemplate === 'string' &&
    typeof record.postResponseUserTemplate === 'string' &&
    typeof record.sceneBriefSchema === 'string' &&
    typeof record.memoryUpdateSchema === 'string' &&
    typeof record.maxRecentMessages === 'number' &&
    typeof directiveRecord.light === 'string' &&
    typeof directiveRecord.standard === 'string' &&
    typeof directiveRecord.firm === 'string'
  )
}

function normalizePromptPresets(
  raw: unknown,
): Record<string, StoredDirectorPromptPreset> {
  if (raw == null || typeof raw !== 'object') return {}

  const entries = Object.entries(raw as Record<string, unknown>)
  const normalized: Record<string, StoredDirectorPromptPreset> = {}

  for (const [key, value] of entries) {
    if (value == null || typeof value !== 'object') continue
    const candidate = value as PersistedPromptPresetLike
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.name !== 'string' ||
      typeof candidate.createdAt !== 'number' ||
      typeof candidate.updatedAt !== 'number' ||
      !isValidPromptPreset(candidate.preset)
    ) {
      continue
    }

    normalized[key] = {
      id: candidate.id,
      name: candidate.name,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
      preset: structuredClone(candidate.preset),
    }
  }

  return normalized
}

export function createBuiltinPromptPresetRecord(): StoredDirectorPromptPreset {
  return {
    id: BUILTIN_PROMPT_PRESET_ID,
    name: BUILTIN_PROMPT_PRESET_NAME,
    createdAt: 0,
    updatedAt: 0,
    preset: structuredClone(DEFAULT_DIRECTOR_PROMPT_PRESET),
  }
}

export function resolveSelectedPromptPreset(
  settings: Pick<DirectorSettings, 'promptPresetId' | 'promptPresets'>,
): StoredDirectorPromptPreset {
  const stored = settings.promptPresets[settings.promptPresetId]
  if (stored) {
    return structuredClone(stored)
  }

  return createBuiltinPromptPresetRecord()
}

export function createPromptPresetFromSettings(
  settings: Pick<DirectorSettings, 'promptPresetId' | 'promptPresets'>,
  name?: string,
): StoredDirectorPromptPreset {
  const now = Date.now()
  const count = Object.keys(settings.promptPresets).length + 1

  return {
    id: `prompt-preset-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: name?.trim() || t('promptPreset.customName', { n: String(count) }),
    createdAt: now,
    updatedAt: now,
    preset: structuredClone(resolvePromptPreset(settings)),
  }
}

// ---------------------------------------------------------------------------
// Built-in profiles
// ---------------------------------------------------------------------------

const BUILTIN_PROFILES: DashboardProfile[] = [
  {
    id: 'builtin-balanced',
    name: 'Balanced',
    createdAt: 0,
    updatedAt: 0,
    basedOn: null,
    overrides: { assertiveness: 'standard' },
  },
  {
    id: 'builtin-gentle',
    name: 'Gentle',
    createdAt: 0,
    updatedAt: 0,
    basedOn: null,
    overrides: { assertiveness: 'light' },
  },
  {
    id: 'builtin-strict',
    name: 'Strict',
    createdAt: 0,
    updatedAt: 0,
    basedOn: null,
    overrides: { assertiveness: 'firm', postReviewEnabled: true },
  },
]

/**
 * Create a fresh profile manifest containing the built-in profiles.
 * The first built-in profile is selected as active.
 */
export function createDefaultProfileManifest(): ProfileManifest {
  const activeProfileId = BUILTIN_PROFILES[0]?.id ?? 'builtin-balanced'
  return {
    version: DASHBOARD_SCHEMA_VERSION,
    activeProfileId,
    profiles: BUILTIN_PROFILES.map((p) => ({ ...p })),
  }
}

// ---------------------------------------------------------------------------
// Export payload
// ---------------------------------------------------------------------------

/**
 * Wrap a single profile in a typed export envelope so it can be
 * shared / imported by other instances.
 */
export function createProfileExportPayload(
  profile: DashboardProfile
): ProfileExportPayload {
  return {
    schema: 'continuity-director-dashboard-profile',
    version: 1,
    profile: { ...profile },
  }
}

/**
 * Wrap the full dashboard settings, profile manifest, and locale into a
 * typed export envelope suitable for JSON display via `api.alert(...)`.
 */
export function createSettingsExportPayload(
  settings: DirectorSettings,
  profiles: ProfileManifest,
  locale: import('./i18n.js').DashboardLocale,
): SettingsExportPayload {
  return {
    schema: 'continuity-director-dashboard-settings',
    version: 1,
    exportedAt: Date.now(),
    locale,
    settings: structuredClone(settings),
    profiles: structuredClone(profiles),
  }
}

function diffSettingsFromDefaults(
  settings: DirectorSettings
): Partial<DirectorSettings> {
  const overrides: Partial<DirectorSettings> = {}
  const mutableOverrides = overrides as Record<string, unknown>
  const entries = Object.entries(settings) as Array<
    [keyof DirectorSettings, DirectorSettings[keyof DirectorSettings]]
  >

  for (const [key, value] of entries) {
    if (JSON.stringify(value) !== JSON.stringify(DEFAULT_DIRECTOR_SETTINGS[key])) {
      mutableOverrides[key] = value
    }
  }

  return overrides
}

export function createProfileFromSettings(
  name: string,
  settings: DirectorSettings,
  basedOn: string | null = null
): DashboardProfile {
  const now = Date.now()
  return {
    id: `profile-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || t('profile.defaultName', { n: String(now) }),
    createdAt: now,
    updatedAt: now,
    basedOn,
    overrides: diffSettingsFromDefaults(settings)
  }
}

export function resolveProfileSettings(profile: DashboardProfile): DirectorSettings {
  return normalizePersistedSettings(profile.overrides)
}

export function parseProfileExportPayload(
  raw: string | ProfileExportPayload | unknown
): DashboardProfile {
  const payload =
    typeof raw === 'string'
      ? parseStoredValue<ProfileExportPayload>(raw)
      : (raw as ProfileExportPayload | null)

  if (
    !payload ||
    payload.schema !== 'continuity-director-dashboard-profile' ||
    payload.version !== 1 ||
    !payload.profile
  ) {
    throw new Error('Invalid dashboard profile import payload')
  }

  return {
    ...payload.profile,
    id: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

function normalizeProfileManifest(raw: PersistedProfileManifestLike | null): ProfileManifest {
  if (
    raw &&
    raw.version === DASHBOARD_SCHEMA_VERSION &&
    typeof raw.activeProfileId === 'string' &&
    Array.isArray(raw.profiles)
  ) {
    const profiles = raw.profiles.filter((profile): profile is DashboardProfile => {
      if (profile == null || typeof profile !== 'object') return false
      const record = profile as Record<string, unknown>
      return (
        typeof record.id === 'string' &&
        typeof record.name === 'string' &&
        typeof record.createdAt === 'number' &&
        typeof record.updatedAt === 'number'
      )
    })

    if (profiles.length > 0) {
      return {
        version: DASHBOARD_SCHEMA_VERSION,
        activeProfileId:
          profiles.some((profile) => profile.id === raw.activeProfileId)
            ? raw.activeProfileId
            : profiles[0]!.id,
        profiles
      }
    }
  }

  return createDefaultProfileManifest()
}

export async function loadDashboardSettings(
  storage: AsyncKeyValueStore,
  fallback?: Partial<DirectorSettings>
): Promise<DirectorSettings> {
  const raw = parseStoredValue<Partial<DirectorSettings>>(
    await storage.getItem(DASHBOARD_SETTINGS_KEY)
  )
  return normalizePersistedSettings({
    ...(fallback ?? {}),
    ...(raw ?? {})
  })
}

export async function saveDashboardSettings(
  storage: AsyncKeyValueStore,
  settings: DirectorSettings
): Promise<void> {
  await storage.setItem(DASHBOARD_SETTINGS_KEY, settings)
}

export async function loadProfileManifest(
  storage: AsyncKeyValueStore
): Promise<ProfileManifest> {
  const raw = parseStoredValue<PersistedProfileManifestLike>(
    await storage.getItem(DASHBOARD_PROFILE_MANIFEST_KEY)
  )
  return normalizeProfileManifest(raw)
}

export async function saveProfileManifest(
  storage: AsyncKeyValueStore,
  manifest: ProfileManifest
): Promise<void> {
  await storage.setItem(DASHBOARD_PROFILE_MANIFEST_KEY, manifest)
}

// ---------------------------------------------------------------------------
// Dream runtime state (persisted per-scope)
// ---------------------------------------------------------------------------

export const DASHBOARD_DREAM_STATE_KEY = 'continuity-director-dashboard-dream-state-v1'

export interface DreamRuntimeState {
  /** Epoch ms of the last successful dream consolidation pass. */
  lastDreamTs: number
  /** Turns observed since the last dream pass. */
  turnsSinceLastDream: number
  /** Sessions observed since the last dream pass. */
  sessionsSinceLastDream: number
}

export function createDefaultDreamState(): DreamRuntimeState {
  return {
    lastDreamTs: 0,
    turnsSinceLastDream: 0,
    sessionsSinceLastDream: 0,
  }
}

export async function loadDreamState(
  storage: AsyncKeyValueStore,
): Promise<DreamRuntimeState> {
  const raw = await storage.getItem<DreamRuntimeState>(DASHBOARD_DREAM_STATE_KEY)
  if (
    raw != null &&
    typeof raw === 'object' &&
    typeof raw.lastDreamTs === 'number' &&
    typeof raw.turnsSinceLastDream === 'number' &&
    typeof raw.sessionsSinceLastDream === 'number'
  ) {
    return raw
  }
  return createDefaultDreamState()
}

export async function saveDreamState(
  storage: AsyncKeyValueStore,
  state: DreamRuntimeState,
): Promise<void> {
  await storage.setItem(DASHBOARD_DREAM_STATE_KEY, state)
}

// ---------------------------------------------------------------------------
// Merge helper
// ---------------------------------------------------------------------------

/**
 * Apply dashboard-level settings back onto a DirectorPluginState snapshot.
 * Returns a **new** state object — the original is not mutated.
 */
export function mergeDashboardSettingsIntoPluginState(
  state: DirectorPluginState,
  dashboardSettings: DirectorSettings
): DirectorPluginState {
  return {
    ...state,
    settings: { ...state.settings, ...dashboardSettings },
  }
}

// ---------------------------------------------------------------------------
// Memory operations status
// ---------------------------------------------------------------------------

export const DASHBOARD_MEMORY_OPS_PREFS_KEY = 'continuity-director-dashboard-memory-ops-prefs-v1'

/** Elapsed time (ms) beyond which notebook is considered stale. */
const FRESHNESS_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

export interface DocumentCounts {
  summaries: number
  continuityFacts: number
  worldFacts: number
  entities: number
  relations: number
}

export interface RecalledDocEntry {
  id: string
  title: string
  freshness: 'current' | 'stale' | 'archived'
}

export interface MemoryOpsStatus {
  lastExtractTs: number
  lastDreamTs: number
  notebookFreshness: 'current' | 'stale' | 'unknown'
  documentCounts: DocumentCounts
  fallbackRetrievalEnabled: boolean
  isMemoryLocked: boolean
  staleWarnings: string[]
  recalledDocs: RecalledDocEntry[]
  diagnostics: DiagnosticsSnapshot
  embeddingCache: EmbeddingCacheStatus
}

export interface MemoryOpsPrefs {
  fallbackRetrievalEnabled: boolean
}

export function createDefaultMemoryOpsStatus(): MemoryOpsStatus {
  return {
    lastExtractTs: 0,
    lastDreamTs: 0,
    notebookFreshness: 'unknown',
    documentCounts: {
      summaries: 0,
      continuityFacts: 0,
      worldFacts: 0,
      entities: 0,
      relations: 0,
    },
    fallbackRetrievalEnabled: false,
    isMemoryLocked: false,
    staleWarnings: [],
    recalledDocs: [],
    diagnostics: createDefaultDiagnosticsSnapshot(),
    embeddingCache: {
      enabled: false,
      supported: true,
      readyCount: 0,
      staleCount: 0,
      missingCount: 0,
      currentVersion: '',
    },
  }
}

export function computeDocumentCounts(memory: CanonicalMemory): DocumentCounts {
  return {
    summaries: memory.summaries.length,
    continuityFacts: memory.continuityFacts.length,
    worldFacts: memory.worldFacts.length,
    entities: memory.entities.length,
    relations: memory.relations.length,
  }
}

export function computeNotebookFreshness(
  lastExtractTs: number,
  lastDreamTs: number,
): 'current' | 'stale' | 'unknown' {
  const latest = Math.max(lastExtractTs, lastDreamTs)
  if (latest === 0) return 'unknown'
  const elapsed = Date.now() - latest
  return elapsed > FRESHNESS_STALE_THRESHOLD_MS ? 'stale' : 'current'
}

export async function loadMemoryOpsPrefs(
  storage: AsyncKeyValueStore,
): Promise<MemoryOpsPrefs> {
  const raw = await storage.getItem<MemoryOpsPrefs>(DASHBOARD_MEMORY_OPS_PREFS_KEY)
  if (
    raw != null &&
    typeof raw === 'object' &&
    typeof raw.fallbackRetrievalEnabled === 'boolean'
  ) {
    return raw
  }
  return { fallbackRetrievalEnabled: false }
}

export async function saveMemoryOpsPrefs(
  storage: AsyncKeyValueStore,
  prefs: MemoryOpsPrefs,
): Promise<void> {
  await storage.setItem(DASHBOARD_MEMORY_OPS_PREFS_KEY, prefs)
}

// ---------------------------------------------------------------------------
// Memory Workbench state
// ---------------------------------------------------------------------------

export type { MemoryWorkbenchInput, WorkbenchDocEntry, WorkbenchFilters, WorkbenchNotebookSnapshot } from './memoryWorkbenchDom.js'

export function createDefaultWorkbenchInput(): import('./memoryWorkbenchDom.js').MemoryWorkbenchInput {
  return {
    documents: [],
    memoryMdPreview: null,
    notebookSnapshot: null,
    loading: false,
    error: null,
    filters: { type: null, freshness: null, source: null },
  }
}
