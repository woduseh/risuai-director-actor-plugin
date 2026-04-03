import type { RisuaiApi } from '../contracts/risuai.js'
import type { DirectorProvider, DirectorSettings } from '../contracts/types.js'

/* ------------------------------------------------------------------ */
/*  Provider catalog                                                  */
/* ------------------------------------------------------------------ */

export interface ProviderCatalogEntry {
  id: DirectorProvider
  label: string
  baseUrl: string
  manualModelOnly: boolean
}

export const DIRECTOR_PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    manualModelOnly: false
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    manualModelOnly: true
  },
  {
    id: 'google',
    label: 'Google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    manualModelOnly: true
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    manualModelOnly: false
  }
] as const

/* ------------------------------------------------------------------ */
/*  Provider defaults resolver                                        */
/* ------------------------------------------------------------------ */

export function resolveProviderDefaults(
  providerId: DirectorProvider
): ProviderCatalogEntry {
  const entry = DIRECTOR_PROVIDER_CATALOG.find((e) => e.id === providerId)
  if (entry) return { ...entry }
  return { id: providerId, label: providerId, baseUrl: '', manualModelOnly: true }
}

/* ------------------------------------------------------------------ */
/*  Curated fallback model lists                                      */
/* ------------------------------------------------------------------ */

const ANTHROPIC_FALLBACK_MODELS: string[] = [
  'claude-3-5-haiku-latest',
  'claude-3-5-sonnet-latest',
  'claude-3-7-sonnet-latest',
  'claude-sonnet-4-20250514'
]

const GOOGLE_FALLBACK_MODELS: string[] = [
  'gemini-2.0-flash',
  'gemini-2.5-flash-preview-04-17',
  'gemini-2.5-pro-preview-05-06'
]

/* ------------------------------------------------------------------ */
/*  Model list loading                                                */
/* ------------------------------------------------------------------ */

interface OpenAIModelsResponseEntry {
  id: string
  [key: string]: unknown
}

/**
 * Load available model IDs for the currently configured provider.
 *
 * - **openai / custom**: hits the `/models` endpoint via `nativeFetch`
 *   and returns a sorted, deduplicated list of model IDs.
 * - **anthropic / google**: returns a curated fallback list because
 *   these providers do not expose a simple `/models` endpoint.
 */
export async function loadProviderModels(
  api: RisuaiApi,
  settings: DirectorSettings
): Promise<string[]> {
  const provider = settings.directorProvider

  if (provider === 'anthropic') return [...ANTHROPIC_FALLBACK_MODELS]
  if (provider === 'google') return [...GOOGLE_FALLBACK_MODELS]

  // openai / custom – fetch the /models endpoint
  const baseUrl = settings.directorBaseUrl
  if (!baseUrl) {
    throw new Error('Base URL is required for model listing')
  }
  if (!settings.directorApiKey) {
    throw new Error('API key is required for model listing')
  }

  const response = await api.nativeFetch(`${baseUrl}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${settings.directorApiKey}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(
      `Model listing failed (HTTP ${String(response.status)})`
    )
  }

  const json = (await response.json()) as {
    data?: OpenAIModelsResponseEntry[]
  }
  const entries = json.data ?? []
  const ids = entries.map((entry) => entry.id)

  return [...new Set(ids)].sort()
}

/* ------------------------------------------------------------------ */
/*  Connection test                                                   */
/* ------------------------------------------------------------------ */

export type ConnectionTestResult =
  | { ok: true; models: string[] }
  | { ok: false; error: string }

/**
 * Perform a lightweight connection test against the configured
 * director provider.  Returns a structured result with either the
 * available model list or a human-readable error message.
 */
export async function testDirectorConnection(
  api: RisuaiApi,
  settings: DirectorSettings
): Promise<ConnectionTestResult> {
  try {
    const provider = settings.directorProvider

    if (!settings.directorApiKey) {
      return { ok: false, error: 'API key is not configured' }
    }

    if (provider === 'anthropic' || provider === 'google') {
      // No live listing endpoint – return the curated list as a
      // "connection ok" signal.
      const models =
        provider === 'anthropic'
          ? [...ANTHROPIC_FALLBACK_MODELS]
          : [...GOOGLE_FALLBACK_MODELS]
      return { ok: true, models }
    }

    // openai / custom
    const baseUrl = settings.directorBaseUrl
    if (!baseUrl) {
      return { ok: false, error: 'Base URL is not configured' }
    }

    const response = await api.nativeFetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${settings.directorApiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      return {
        ok: false,
        error: `Server returned HTTP ${String(response.status)}`
      }
    }

    const json = (await response.json()) as {
      data?: OpenAIModelsResponseEntry[]
    }
    const entries = json.data ?? []
    const models = [...new Set(entries.map((e) => e.id))].sort()
    return { ok: true, models }
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Unknown connection error'
    return { ok: false, error: message }
  }
}
