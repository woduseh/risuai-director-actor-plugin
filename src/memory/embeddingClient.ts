/**
 * Host-safe embedding client abstraction.
 *
 * Routes embedding requests through the RisuAI `nativeFetch` API
 * instead of raw browser fetch. Supports OpenAI-compatible providers
 * (openai, voyageai, custom) and Google Gemini embeddings.
 *
 * Vertex AI is explicitly unsupported in this slice — calls return a
 * graceful error without crashing retrieval.
 */

import type { EmbeddingProvider } from '../contracts/types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingClientConfig {
  provider: EmbeddingProvider | string
  baseUrl: string
  apiKey: string
  model: string
  dimensions: number
}

export type EmbeddingResult =
  | { ok: true; vector: number[] }
  | { ok: false; error: string }

export interface EmbeddingClient {
  embed(text: string): Promise<EmbeddingResult>
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>
}

type NativeFetchFn = (url: string, options?: RequestInit) => Promise<Response>

// ---------------------------------------------------------------------------
// Provider support check
// ---------------------------------------------------------------------------

const SUPPORTED_PROVIDERS = new Set<string>([
  'openai',
  'voyageai',
  'google',
  'custom',
])

/** Check whether a provider is supported by this embedding client. */
export function isProviderSupported(provider: string): boolean {
  return SUPPORTED_PROVIDERS.has(provider)
}

// ---------------------------------------------------------------------------
// OpenAI-compatible embedding request
// ---------------------------------------------------------------------------

async function embedOpenAICompatible(
  text: string,
  config: EmbeddingClientConfig,
  nativeFetch: NativeFetchFn,
): Promise<EmbeddingResult> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/embeddings`

  const response = await nativeFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      input: text,
      dimensions: config.dimensions,
    }),
  })

  if (!response.ok) {
    return { ok: false, error: `Embedding request failed (HTTP ${response.status})` }
  }

  const json = await response.json() as {
    data?: Array<{ embedding?: number[] }>
  }

  const vector = json?.data?.[0]?.embedding
  if (!Array.isArray(vector)) {
    return { ok: false, error: 'Malformed embedding response: missing data[0].embedding' }
  }

  return { ok: true, vector }
}

// ---------------------------------------------------------------------------
// Google Gemini embedding request
// ---------------------------------------------------------------------------

async function embedGemini(
  text: string,
  config: EmbeddingClientConfig,
  nativeFetch: NativeFetchFn,
): Promise<EmbeddingResult> {
  const base = config.baseUrl.replace(/\/+$/, '')
  const url = `${base}/models/${config.model}:embedContent?key=${config.apiKey}`

  const response = await nativeFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: {
        parts: [{ text }],
      },
    }),
  })

  if (!response.ok) {
    return { ok: false, error: `Gemini embedding request failed (HTTP ${response.status})` }
  }

  const json = await response.json() as {
    embedding?: { values?: number[] }
  }

  const vector = json?.embedding?.values
  if (!Array.isArray(vector)) {
    return { ok: false, error: 'Malformed Gemini response: missing embedding.values' }
  }

  return { ok: true, vector }
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/**
 * Create a host-safe embedding client for the given configuration.
 *
 * The client routes through `nativeFetch` (from `RisuaiApi`) rather
 * than using raw browser `fetch`, ensuring host-environment
 * compatibility.
 */
export function createEmbeddingClient(
  config: EmbeddingClientConfig,
  nativeFetch: NativeFetchFn,
): EmbeddingClient {
  async function embed(text: string): Promise<EmbeddingResult> {
    if (!isProviderSupported(config.provider)) {
      return {
        ok: false,
        error: `Embedding provider "${config.provider}" is unsupported in this version`,
      }
    }

    try {
      if (config.provider === 'google') {
        return await embedGemini(text, config, nativeFetch)
      }
      // openai, voyageai, custom all use OpenAI-compatible format
      return await embedOpenAICompatible(text, config, nativeFetch)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message }
    }
  }

  async function embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = []
    for (const text of texts) {
      results.push(await embed(text))
    }
    return results
  }

  return { embed, embedBatch }
}
