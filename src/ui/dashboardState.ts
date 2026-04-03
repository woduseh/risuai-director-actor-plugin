import type { AsyncKeyValueStore } from '../contracts/risuai.js'
import type {
  DirectorPromptPreset,
  DirectorSettings,
  DirectorPluginState,
  StoredDirectorPromptPreset,
} from '../contracts/types.js'
import { DEFAULT_DIRECTOR_SETTINGS } from '../contracts/types.js'
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

export const DASHBOARD_SETTINGS_KEY = 'dashboard-settings-v1'
export const DASHBOARD_PROFILE_MANIFEST_KEY = 'dashboard-profile-manifest-v1'
export const DASHBOARD_LOCALE_KEY = 'dashboard-locale-v1'
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
    schema: 'director-actor-dashboard-profile',
    version: 1,
    profile: { ...profile },
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
    payload.schema !== 'director-actor-dashboard-profile' ||
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
