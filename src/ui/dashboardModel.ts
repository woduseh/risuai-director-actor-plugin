import type { RisuaiApi } from '../contracts/risuai.js'
import type {
  DirectorProvider,
  DirectorSettings,
  EmbeddingProvider,
} from '../contracts/types.js'
import type { TranslationKey } from './i18n.js'

/* ------------------------------------------------------------------ */
/*  Provider catalog                                                  */
/* ------------------------------------------------------------------ */

export type ProviderAuthMode = 'api-key' | 'oauth-device-flow' | 'manual-advanced'

export interface ProviderCatalogEntry {
  id: DirectorProvider
  label: string
  baseUrl: string
  manualModelOnly: boolean
  authMode: ProviderAuthMode
  curatedModels: string[]
}

export interface EmbeddingProviderCatalogEntry {
  id: EmbeddingProvider
  baseUrl: string
  authMode: ProviderAuthMode
}

export const DIRECTOR_PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    manualModelOnly: false,
    authMode: 'api-key',
    curatedModels: [
      'gpt-4.1-mini',
      'gpt-4.1',
      'gpt-5.3-codex',
      'gpt-5.4-nano',
      'gpt-5.4-mini',
      'gpt-5.4',
      'gpt-5.4-pro',
    ]
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    manualModelOnly: true,
    authMode: 'api-key',
    curatedModels: [
      'claude-3-5-haiku-latest',
      'claude-3-5-sonnet-latest',
      'claude-3-7-sonnet-latest',
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'claude-opus-4-6-fast',
    ]
  },
  {
    id: 'google',
    label: 'Google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    manualModelOnly: true,
    authMode: 'api-key',
    curatedModels: [
      'gemini-2.0-flash',
      'gemini-2.5-flash-preview-04-17',
      'gemini-2.5-pro-preview-05-06',
      'gemini-3.1-pro-preview',
      'gemini-3.1-pro-preview-customtools',
      'gemini-3.1-flash-lite-preview',
      'gemini-3.1-flash-live-preview',
    ]
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    baseUrl: 'https://api.githubcopilot.com/v1',
    manualModelOnly: true,
    authMode: 'oauth-device-flow',
    curatedModels: ['gpt-4.1', 'gpt-5.4', 'claude-sonnet-4-6', 'claude-opus-4-6']
  },
  {
    id: 'vertex',
    label: 'Google Vertex AI',
    baseUrl: '',
    manualModelOnly: true,
    authMode: 'manual-advanced',
    curatedModels: [
      'gemini-2.5-pro-preview-05-06',
      'gemini-3.1-pro-preview',
      'gemini-3.1-pro-preview-customtools',
      'gemini-3.1-flash-lite-preview',
      'claude-sonnet-4-6',
      'claude-opus-4-6',
    ]
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    manualModelOnly: false,
    authMode: 'api-key',
    curatedModels: []
  }
] as const

export const EMBEDDING_PROVIDER_CATALOG: readonly EmbeddingProviderCatalogEntry[] = [
  {
    id: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    authMode: 'api-key',
  },
  {
    id: 'voyageai',
    baseUrl: 'https://api.voyageai.com/v1',
    authMode: 'api-key',
  },
  {
    id: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authMode: 'api-key',
  },
  {
    id: 'vertex',
    baseUrl: '',
    authMode: 'manual-advanced',
  },
  {
    id: 'custom',
    baseUrl: '',
    authMode: 'api-key',
  },
] as const

/* ------------------------------------------------------------------ */
/*  Provider defaults resolver                                        */
/* ------------------------------------------------------------------ */

export function resolveProviderDefaults(
  providerId: DirectorProvider
): ProviderCatalogEntry {
  const entry = DIRECTOR_PROVIDER_CATALOG.find((e) => e.id === providerId)
  if (entry) return { ...entry }
  return {
    id: providerId,
    label: providerId,
    baseUrl: '',
    manualModelOnly: true,
    authMode: 'api-key',
    curatedModels: []
  }
}

export function resolveEmbeddingDefaults(
  providerId: EmbeddingProvider
): EmbeddingProviderCatalogEntry {
  const entry = EMBEDDING_PROVIDER_CATALOG.find((e) => e.id === providerId)
  if (entry) return { ...entry }
  return {
    id: providerId,
    baseUrl: '',
    authMode: 'api-key',
  }
}

/* ------------------------------------------------------------------ */
/*  Provider auth field descriptors                                   */
/* ------------------------------------------------------------------ */

export interface ProviderAuthFieldDescriptor {
  field: keyof DirectorSettings
  labelKey: TranslationKey
  inputType: 'text' | 'password' | 'textarea'
}

const STANDARD_DIRECTOR_AUTH: readonly ProviderAuthFieldDescriptor[] = [
  { field: 'directorBaseUrl', labelKey: 'label.baseUrl', inputType: 'text' },
  { field: 'directorApiKey', labelKey: 'label.apiKey', inputType: 'password' },
]

const COPILOT_DIRECTOR_AUTH: readonly ProviderAuthFieldDescriptor[] = [
  { field: 'directorCopilotToken', labelKey: 'label.copilotToken', inputType: 'password' },
]

const VERTEX_DIRECTOR_AUTH: readonly ProviderAuthFieldDescriptor[] = [
  { field: 'directorVertexJsonKey', labelKey: 'label.vertexJsonKey', inputType: 'textarea' },
  { field: 'directorVertexProject', labelKey: 'label.vertexProject', inputType: 'text' },
  { field: 'directorVertexLocation', labelKey: 'label.vertexLocation', inputType: 'text' },
]

/**
 * Return the auth-related field descriptors for a given director provider.
 * Used by the dashboard DOM to conditionally render the correct inputs.
 */
export function directorAuthFields(
  provider: DirectorProvider
): readonly ProviderAuthFieldDescriptor[] {
  switch (provider) {
    case 'copilot':
      return COPILOT_DIRECTOR_AUTH
    case 'vertex':
      return VERTEX_DIRECTOR_AUTH
    default:
      return STANDARD_DIRECTOR_AUTH
  }
}

const STANDARD_EMBEDDING_AUTH: readonly ProviderAuthFieldDescriptor[] = [
  { field: 'embeddingBaseUrl', labelKey: 'label.embeddingBaseUrl', inputType: 'text' },
  { field: 'embeddingApiKey', labelKey: 'label.embeddingApiKey', inputType: 'password' },
]

const VERTEX_EMBEDDING_AUTH: readonly ProviderAuthFieldDescriptor[] = [
  { field: 'embeddingVertexJsonKey', labelKey: 'label.embeddingVertexJsonKey', inputType: 'textarea' },
  { field: 'embeddingVertexProject', labelKey: 'label.embeddingVertexProject', inputType: 'text' },
  { field: 'embeddingVertexLocation', labelKey: 'label.embeddingVertexLocation', inputType: 'text' },
]

/**
 * Return the auth-related field descriptors for a given embedding provider.
 */
export function embeddingAuthFields(
  provider: EmbeddingProvider
): readonly ProviderAuthFieldDescriptor[] {
  switch (provider) {
    case 'vertex':
      return VERTEX_EMBEDDING_AUTH
    default:
      return STANDARD_EMBEDDING_AUTH
  }
}

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
 * - **anthropic / google / copilot / vertex**: returns the curated
 *   fallback list because these providers do not expose a simple
 *   `/models` endpoint.
 */
export async function loadProviderModels(
  api: RisuaiApi,
  settings: DirectorSettings
): Promise<string[]> {
  const provider = settings.directorProvider
  const catalogEntry = DIRECTOR_PROVIDER_CATALOG.find((e) => e.id === provider)

  // Providers that are manualModelOnly return curated list
  if (catalogEntry?.manualModelOnly) {
    return [...(catalogEntry.curatedModels)]
  }

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
    const catalogEntry = DIRECTOR_PROVIDER_CATALOG.find((e) => e.id === provider)

    if (catalogEntry?.manualModelOnly) {
      if (catalogEntry.authMode === 'api-key' && !settings.directorApiKey) {
        return { ok: false, error: 'API key is not configured' }
      }

      // No live listing endpoint – return the curated list as a
      // "connection ok" signal.
      return { ok: true, models: [...catalogEntry.curatedModels] }
    }

    if (!settings.directorApiKey) {
      return { ok: false, error: 'API key is not configured' }
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
