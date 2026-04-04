import { describe, test, expect, vi, beforeAll } from 'vitest'
import {
  createEmbeddingClient,
  isProviderSupported,
  type EmbeddingClientConfig,
  type EmbeddingResult,
} from '../src/memory/embeddingClient.js'
import { createVertexServiceAccountJson } from './helpers/vertexTestUtils.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<EmbeddingClientConfig>): EmbeddingClientConfig {
  return {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test-key',
    model: 'text-embedding-3-small',
    dimensions: 4,
    ...overrides,
  }
}

function makeNativeFetch(responses: Array<{ ok: boolean; body: unknown; status?: number }>): (url: string, options?: RequestInit) => Promise<Response> {
  const queue = [...responses]
  return vi.fn(async () => {
    const next = queue.shift()
    if (!next) throw new Error('fetch queue exhausted')
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? (next.ok ? 200 : 500),
      headers: { 'content-type': 'application/json' },
    })
  })
}

// ---------------------------------------------------------------------------
// isProviderSupported
// ---------------------------------------------------------------------------

describe('isProviderSupported', () => {
  test('openai is supported', () => {
    expect(isProviderSupported('openai')).toBe(true)
  })

  test('voyageai is supported', () => {
    expect(isProviderSupported('voyageai')).toBe(true)
  })

  test('google is supported', () => {
    expect(isProviderSupported('google')).toBe(true)
  })

  test('custom is supported', () => {
    expect(isProviderSupported('custom')).toBe(true)
  })

  test('vertex is supported', () => {
    expect(isProviderSupported('vertex')).toBe(true)
  })

  test('unknown providers are not supported', () => {
    expect(isProviderSupported('foobar' as never)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createEmbeddingClient — OpenAI-compatible providers
// ---------------------------------------------------------------------------

describe('createEmbeddingClient — OpenAI-compatible', () => {
  test('returns embedding vector on success', async () => {
    const nativeFetch = makeNativeFetch([{
      ok: true,
      body: {
        data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }],
      },
    }])

    const client = createEmbeddingClient(makeConfig(), nativeFetch)
    const result = await client.embed('hello world')

    expect(result.ok).toBe(true)
    expect((result as Extract<EmbeddingResult, { ok: true }>).vector).toEqual([0.1, 0.2, 0.3, 0.4])
  })

  test('calls correct URL for openai provider', async () => {
    const nativeFetch = makeNativeFetch([{
      ok: true,
      body: { data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] },
    }])

    const client = createEmbeddingClient(makeConfig(), nativeFetch)
    await client.embed('test')

    expect(nativeFetch).toHaveBeenCalledTimes(1)
    const [url, opts] = (nativeFetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/embeddings')
    expect(opts.method).toBe('POST')

    const body = JSON.parse(opts.body)
    expect(body.model).toBe('text-embedding-3-small')
    expect(body.input).toBe('test')
  })

  test('includes authorization header', async () => {
    const nativeFetch = makeNativeFetch([{
      ok: true,
      body: { data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] },
    }])

    const client = createEmbeddingClient(makeConfig(), nativeFetch)
    await client.embed('test')

    const [, opts] = (nativeFetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(opts.headers['Authorization']).toBe('Bearer sk-test-key')
  })

  test('returns error result on HTTP failure', async () => {
    const nativeFetch = makeNativeFetch([{
      ok: false,
      status: 401,
      body: { error: { message: 'Invalid API key' } },
    }])

    const client = createEmbeddingClient(makeConfig(), nativeFetch)
    const result = await client.embed('test')

    expect(result.ok).toBe(false)
    expect((result as Extract<EmbeddingResult, { ok: false }>).error).toContain('401')
  })

  test('returns error result on malformed response', async () => {
    const nativeFetch = makeNativeFetch([{
      ok: true,
      body: { wrong: 'shape' },
    }])

    const client = createEmbeddingClient(makeConfig(), nativeFetch)
    const result = await client.embed('test')

    expect(result.ok).toBe(false)
  })

  test('returns error result on network exception', async () => {
    const nativeFetch = vi.fn(async () => {
      throw new Error('Network failure')
    })

    const client = createEmbeddingClient(makeConfig(), nativeFetch as never)
    const result = await client.embed('test')

    expect(result.ok).toBe(false)
    expect((result as Extract<EmbeddingResult, { ok: false }>).error).toContain('Network failure')
  })

  test('voyageai uses same OpenAI-compatible endpoint', async () => {
    const nativeFetch = makeNativeFetch([{
      ok: true,
      body: { data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] },
    }])

    const client = createEmbeddingClient(
      makeConfig({ provider: 'voyageai', baseUrl: 'https://api.voyageai.com/v1' }),
      nativeFetch,
    )
    await client.embed('test')

    const [url] = (nativeFetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(url).toBe('https://api.voyageai.com/v1/embeddings')
  })

  test('custom provider uses configured base URL', async () => {
    const nativeFetch = makeNativeFetch([{
      ok: true,
      body: { data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] },
    }])

    const client = createEmbeddingClient(
      makeConfig({ provider: 'custom', baseUrl: 'https://my-server.com/api' }),
      nativeFetch,
    )
    await client.embed('test')

    const [url] = (nativeFetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(url).toBe('https://my-server.com/api/embeddings')
  })
})

// ---------------------------------------------------------------------------
// createEmbeddingClient — Google Gemini
// ---------------------------------------------------------------------------

describe('createEmbeddingClient — Google Gemini', () => {
  test('calls correct Gemini embedding URL', async () => {
    const nativeFetch = makeNativeFetch([{
      ok: true,
      body: {
        embedding: { values: [0.5, 0.6, 0.7, 0.8] },
      },
    }])

    const client = createEmbeddingClient(
      makeConfig({
        provider: 'google',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        model: 'text-embedding-004',
      }),
      nativeFetch,
    )
    const result = await client.embed('hello')

    expect(result.ok).toBe(true)
    expect((result as Extract<EmbeddingResult, { ok: true }>).vector).toEqual([0.5, 0.6, 0.7, 0.8])

    const [url] = (nativeFetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(url).toContain('models/text-embedding-004:embedContent')
    expect(url).toContain('key=')
  })

  test('Gemini passes content in correct request format', async () => {
    const nativeFetch = makeNativeFetch([{
      ok: true,
      body: { embedding: { values: [0.1, 0.2, 0.3, 0.4] } },
    }])

    const client = createEmbeddingClient(
      makeConfig({
        provider: 'google',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        model: 'text-embedding-004',
      }),
      nativeFetch,
    )
    await client.embed('test input')

    const [, opts] = (nativeFetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    const body = JSON.parse(opts.body)
    expect(body.content.parts[0].text).toBe('test input')
  })
})

// ---------------------------------------------------------------------------
// createEmbeddingClient — Vertex AI
// ---------------------------------------------------------------------------

describe('createEmbeddingClient — Vertex AI', () => {
  let vertexJsonKey = ''

  beforeAll(async () => {
    vertexJsonKey = await createVertexServiceAccountJson()
  })

  test('vertex embeds with predict endpoint and parses vectors', async () => {
    const nativeFetch = makeNativeFetch([
      {
        ok: true,
        body: { access_token: 'ya29.vertex-token', expires_in: 3600 },
      },
      {
        ok: true,
        body: {
          predictions: [{ embeddings: { values: [0.9, 0.8, 0.7] } }],
        },
      },
    ])

    const client = createEmbeddingClient(
      makeConfig({
        provider: 'vertex',
        baseUrl: '',
        apiKey: '',
        model: 'text-embedding-005',
        dimensions: 256,
        vertexJsonKey,
        vertexProject: '',
        vertexLocation: '',
      }),
      nativeFetch as never,
    )
    const result = await client.embed('test')

    expect(result.ok).toBe(true)
    expect((result as Extract<EmbeddingResult, { ok: true }>).vector).toEqual([
      0.9, 0.8, 0.7,
    ])

    const [url, opts] = (nativeFetch as ReturnType<typeof vi.fn>).mock.calls[1]!
    expect(url).toContain('/publishers/google/models/text-embedding-005:predict')
    const body = JSON.parse(opts.body)
    expect(body.parameters.outputDimensionality).toBe(256)
  })

  test('returns error when Vertex JSON key is empty', async () => {
    const nativeFetch = vi.fn()

    const client = createEmbeddingClient(
      makeConfig({
        provider: 'vertex',
        baseUrl: '',
        apiKey: '',
        model: 'text-embedding-005',
        vertexJsonKey: '',
        vertexProject: '',
        vertexLocation: '',
      }),
      nativeFetch as never,
    )

    const result = await client.embed('hello')
    expect(result.ok).toBe(false)
    expect(nativeFetch).not.toHaveBeenCalled()
  })

  test('returns error on Vertex API failure', async () => {
    const nativeFetch = makeNativeFetch([
      { ok: true, body: { access_token: 'ya29.test', expires_in: 3600 } },
      { ok: false, status: 500, body: { error: 'server error' } },
    ])

    const client = createEmbeddingClient(
      makeConfig({
        provider: 'vertex',
        baseUrl: '',
        apiKey: '',
        model: 'text-embedding-005',
        vertexJsonKey,
        vertexProject: '',
        vertexLocation: '',
      }),
      nativeFetch as never,
    )

    const result = await client.embed('hello')
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// embedBatch
// ---------------------------------------------------------------------------

describe('createEmbeddingClient — embedBatch', () => {
  test('embeds multiple texts and returns results in order', async () => {
    const nativeFetch = makeNativeFetch([
      { ok: true, body: { data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] } },
      { ok: true, body: { data: [{ embedding: [0.5, 0.6, 0.7, 0.8] }] } },
    ])

    const client = createEmbeddingClient(makeConfig(), nativeFetch)
    const results = await client.embedBatch(['hello', 'world'])

    expect(results).toHaveLength(2)
    expect(results[0]!.ok).toBe(true)
    expect(results[1]!.ok).toBe(true)
  })

  test('partial failures do not block other items', async () => {
    const nativeFetch = makeNativeFetch([
      { ok: false, status: 500, body: { error: 'server error' } },
      { ok: true, body: { data: [{ embedding: [0.5, 0.6, 0.7, 0.8] }] } },
    ])

    const client = createEmbeddingClient(makeConfig(), nativeFetch)
    const results = await client.embedBatch(['fail', 'succeed'])

    expect(results[0]!.ok).toBe(false)
    expect(results[1]!.ok).toBe(true)
  })

  test('empty batch returns empty results', async () => {
    const nativeFetch = vi.fn()
    const client = createEmbeddingClient(makeConfig(), nativeFetch as never)
    const results = await client.embedBatch([])

    expect(results).toEqual([])
    expect(nativeFetch).not.toHaveBeenCalled()
  })
})
