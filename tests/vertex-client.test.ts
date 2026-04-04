import { describe, test, expect, beforeAll } from 'vitest'
import {
  createVertexClient,
  parseServiceAccountJson,
  resolveVertexApiBase,
  getSharedVertexClient,
  GCP_OAUTH_TOKEN_URL,
  type FetchFn,
} from '../src/provider/vertexClient.js'
import type { RisuaiApi } from '../src/contracts/risuai.js'
import { createVertexServiceAccountJson } from './helpers/vertexTestUtils.js'

// ---------------------------------------------------------------------------
// Mock fetch helper
// ---------------------------------------------------------------------------

function createMockFetch() {
  const calls: Array<{ url: string; init?: RequestInit | undefined }> = []
  const queue: Response[] = []

  const fn: FetchFn = async (url, init) => {
    calls.push({ url, init })
    const response = queue.shift()
    if (!response) {
      throw new Error('Mock fetch queue exhausted')
    }
    return response
  }

  function enqueueJson(body: unknown, status = 200): void {
    queue.push(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }

  return { fn, calls, enqueueJson }
}

// ---------------------------------------------------------------------------
// parseServiceAccountJson
// ---------------------------------------------------------------------------

describe('parseServiceAccountJson', () => {
  let serviceAccountJson = ''

  beforeAll(async () => {
    serviceAccountJson = await createVertexServiceAccountJson()
  })

  test('parses valid service-account JSON and returns structured fields', () => {
    const parsed = parseServiceAccountJson(serviceAccountJson)
    expect(parsed.project_id).toBe('vertex-test-project')
    expect(parsed.client_email).toContain('@')
    expect(parsed.private_key).toContain('BEGIN PRIVATE KEY')
  })

  test('accepts PKCS#8 private key format', async () => {
    const json = await createVertexServiceAccountJson()
    const parsed = parseServiceAccountJson(json)
    expect(parsed.private_key).toContain('-----BEGIN PRIVATE KEY-----')
  })

  test('rejects empty string', () => {
    expect(() => parseServiceAccountJson('')).toThrow(/empty/i)
  })

  test('rejects Unix file path instead of JSON content', () => {
    expect(() => parseServiceAccountJson('/path/to/key.json')).toThrow(
      /path/i,
    )
  })

  test('rejects Windows file path', () => {
    expect(() =>
      parseServiceAccountJson('C:\\Users\\wodus\\vertex.json'),
    ).toThrow(/path/i)
  })

  test('rejects invalid JSON', () => {
    expect(() => parseServiceAccountJson('{bad json')).toThrow(/JSON/i)
  })

  test('rejects JSON missing client_email', () => {
    const json = JSON.stringify({
      project_id: 'p',
      private_key: '-----BEGIN PRIVATE KEY-----\ndata\n-----END PRIVATE KEY-----\n',
    })
    expect(() => parseServiceAccountJson(json)).toThrow(/client_email/i)
  })

  test('rejects JSON missing private_key', () => {
    const json = JSON.stringify({
      project_id: 'p',
      client_email: 'test@test.iam.gserviceaccount.com',
    })
    expect(() => parseServiceAccountJson(json)).toThrow(/private_key/i)
  })

  test('rejects private_key that does not look like a PEM', () => {
    const json = JSON.stringify({
      project_id: 'p',
      client_email: 'test@test.iam.gserviceaccount.com',
      private_key: 'not-a-pem-string',
    })
    expect(() => parseServiceAccountJson(json)).toThrow(/PEM/i)
  })

  test('does not expose private key material in error messages', () => {
    const json = JSON.stringify({
      project_id: 'p',
      client_email: '',
      private_key: '-----BEGIN PRIVATE KEY-----\nSECRETDATA\n-----END PRIVATE KEY-----\n',
    })
    try {
      parseServiceAccountJson(json)
    } catch (err: unknown) {
      const msg = (err as Error).message
      expect(msg).not.toContain('SECRETDATA')
      expect(msg).not.toContain('BEGIN PRIVATE KEY')
    }
  })
})

// ---------------------------------------------------------------------------
// resolveVertexApiBase
// ---------------------------------------------------------------------------

describe('resolveVertexApiBase', () => {
  test('global location uses aiplatform.googleapis.com', () => {
    expect(resolveVertexApiBase('global')).toBe(
      'https://aiplatform.googleapis.com',
    )
  })

  test('regional location uses location-prefixed URL', () => {
    expect(resolveVertexApiBase('us-central1')).toBe(
      'https://us-central1-aiplatform.googleapis.com',
    )
  })

  test('europe-west4 uses location-prefixed URL', () => {
    expect(resolveVertexApiBase('europe-west4')).toBe(
      'https://europe-west4-aiplatform.googleapis.com',
    )
  })
})

// ---------------------------------------------------------------------------
// createVertexClient
// ---------------------------------------------------------------------------

describe('createVertexClient', () => {
  let serviceAccountJson = ''

  beforeAll(async () => {
    serviceAccountJson = await createVertexServiceAccountJson()
  })

  // -----------------------------------------------------------------------
  // Token exchange & caching
  // -----------------------------------------------------------------------

  test('exchanges JWT for OAuth access token via Google token endpoint', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.test-token', expires_in: 3600 })

    const client = createVertexClient(mock.fn)
    const token = await client.getAccessToken(serviceAccountJson)

    expect(token).toBe('ya29.test-token')
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0]!.url).toBe(GCP_OAUTH_TOKEN_URL)

    const body = mock.calls[0]!.init?.body as string
    expect(body).toContain('grant_type=urn')
    expect(body).toContain('assertion=')
  })

  test('caches OAuth tokens per service account', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.cached-token', expires_in: 3600 })

    const client = createVertexClient(mock.fn)
    const first = await client.getAccessToken(serviceAccountJson)
    const second = await client.getAccessToken(serviceAccountJson)

    expect(first).toBe('ya29.cached-token')
    expect(second).toBe('ya29.cached-token')
    expect(mock.calls).toHaveLength(1)
  })

  test('re-exchanges when cached token expires', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.first', expires_in: 0 })
    mock.enqueueJson({ access_token: 'ya29.second', expires_in: 3600 })

    const client = createVertexClient(mock.fn)
    await client.getAccessToken(serviceAccountJson)
    const t2 = await client.getAccessToken(serviceAccountJson)
    expect(t2).toBe('ya29.second')
    expect(mock.calls).toHaveLength(2)
  })

  test('throws on OAuth token exchange HTTP error', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ error: 'invalid_grant' }, 400)

    const client = createVertexClient(mock.fn)
    await expect(
      client.getAccessToken(serviceAccountJson),
    ).rejects.toThrow(/token exchange/i)
  })

  // -----------------------------------------------------------------------
  // complete (generateContent)
  // -----------------------------------------------------------------------

  test('builds correct generateContent URL for global location', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.vertex-token', expires_in: 3600 })
    mock.enqueueJson({
      candidates: [{ content: { parts: [{ text: 'Hello from Vertex' }] } }],
    })

    const client = createVertexClient(mock.fn)
    const text = await client.complete(
      serviceAccountJson,
      '',
      '',
      'gemini-2.5-pro',
      [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi there' },
      ],
    )

    expect(text).toBe('Hello from Vertex')
    expect(mock.calls[1]!.url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/vertex-test-project/locations/global/publishers/google/models/gemini-2.5-pro:generateContent',
    )
  })

  test('builds correct URL for regional location', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.test', expires_in: 3600 })
    mock.enqueueJson({
      candidates: [{ content: { parts: [{ text: 'OK' }] } }],
    })

    const client = createVertexClient(mock.fn)
    await client.complete(serviceAccountJson, '', 'us-central1', 'gemini-2.5-pro', [
      { role: 'user', content: 'Hi' },
    ])

    expect(mock.calls[1]!.url).toContain(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/vertex-test-project/locations/us-central1/',
    )
  })

  test('sends system instruction from system messages', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.test', expires_in: 3600 })
    mock.enqueueJson({
      candidates: [{ content: { parts: [{ text: 'Response' }] } }],
    })

    const client = createVertexClient(mock.fn)
    await client.complete(serviceAccountJson, '', '', 'gemini-2.5-pro', [
      { role: 'system', content: 'You are a helper.' },
      { role: 'user', content: 'Hello' },
    ])

    const body = JSON.parse(mock.calls[1]!.init?.body as string)
    expect(body.systemInstruction).toEqual({
      parts: [{ text: 'You are a helper.' }],
    })
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'Hello' }] },
    ])
    expect(body.generationConfig).toBeDefined()
  })

  test('omits systemInstruction when no system messages present', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.test', expires_in: 3600 })
    mock.enqueueJson({
      candidates: [{ content: { parts: [{ text: 'Response' }] } }],
    })

    const client = createVertexClient(mock.fn)
    await client.complete(serviceAccountJson, '', '', 'gemini-2.5-pro', [
      { role: 'user', content: 'Hello' },
    ])

    const body = JSON.parse(mock.calls[1]!.init?.body as string)
    expect(body.systemInstruction).toBeUndefined()
  })

  test('sends Authorization Bearer header with access token', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.bearer-check', expires_in: 3600 })
    mock.enqueueJson({
      candidates: [{ content: { parts: [{ text: 'OK' }] } }],
    })

    const client = createVertexClient(mock.fn)
    await client.complete(serviceAccountJson, '', '', 'gemini-2.5-pro', [
      { role: 'user', content: 'Hi' },
    ])

    const headers = mock.calls[1]!.init?.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer ya29.bearer-check')
  })

  test('parses multi-part text response from Gemini', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.test', expires_in: 3600 })
    mock.enqueueJson({
      candidates: [
        { content: { parts: [{ text: 'Part A ' }, { text: 'Part B' }] } },
      ],
    })

    const client = createVertexClient(mock.fn)
    const result = await client.complete(
      serviceAccountJson,
      '',
      '',
      'gemini-2.5-pro',
      [{ role: 'user', content: 'Hi' }],
    )

    expect(result).toBe('Part A Part B')
  })

  test('throws on malformed generateContent response', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.test', expires_in: 3600 })
    mock.enqueueJson({ wrong: 'shape' })

    const client = createVertexClient(mock.fn)
    await expect(
      client.complete(serviceAccountJson, '', '', 'gemini-2.5-pro', [
        { role: 'user', content: 'Hi' },
      ]),
    ).rejects.toThrow(/candidates/i)
  })

  test('throws on HTTP error from generateContent', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.test', expires_in: 3600 })
    mock.enqueueJson({ error: { message: 'Quota exceeded' } }, 429)

    const client = createVertexClient(mock.fn)
    await expect(
      client.complete(serviceAccountJson, '', '', 'gemini-2.5-pro', [
        { role: 'user', content: 'Hi' },
      ]),
    ).rejects.toThrow(/429/)
  })

  test('rejects non-Gemini director models explicitly', async () => {
    const client = createVertexClient(createMockFetch().fn)
    await expect(
      client.complete(serviceAccountJson, '', '', 'claude-sonnet-4-6', [
        { role: 'user', content: 'Hi' },
      ]),
    ).rejects.toThrow(/gemini/i)
  })

  test('maps assistant role to model role in Gemini contents', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.test', expires_in: 3600 })
    mock.enqueueJson({
      candidates: [{ content: { parts: [{ text: 'OK' }] } }],
    })

    const client = createVertexClient(mock.fn)
    await client.complete(serviceAccountJson, '', '', 'gemini-2.5-pro', [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'How are you?' },
    ])

    const body = JSON.parse(mock.calls[1]!.init?.body as string)
    expect(body.contents[1].role).toBe('model')
  })

  test('resolves project from explicit parameter over JSON key', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.test', expires_in: 3600 })
    mock.enqueueJson({
      candidates: [{ content: { parts: [{ text: 'OK' }] } }],
    })

    const client = createVertexClient(mock.fn)
    await client.complete(
      serviceAccountJson,
      'explicit-project',
      '',
      'gemini-2.5-pro',
      [{ role: 'user', content: 'Hi' }],
    )

    expect(mock.calls[1]!.url).toContain('/projects/explicit-project/')
  })

  test('falls back to project_id from JSON key when parameter is empty', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.test', expires_in: 3600 })
    mock.enqueueJson({
      candidates: [{ content: { parts: [{ text: 'OK' }] } }],
    })

    const client = createVertexClient(mock.fn)
    await client.complete(serviceAccountJson, '', '', 'gemini-2.5-pro', [
      { role: 'user', content: 'Hi' },
    ])

    expect(mock.calls[1]!.url).toContain('/projects/vertex-test-project/')
  })

  test('errors when no project can be resolved', async () => {
    const noProjectJson = await createVertexServiceAccountJson({
      project_id: '',
    })
    const client = createVertexClient(createMockFetch().fn)

    await expect(
      client.complete(noProjectJson, '', '', 'gemini-2.5-pro', [
        { role: 'user', content: 'Hi' },
      ]),
    ).rejects.toThrow(/project/i)
  })

  // -----------------------------------------------------------------------
  // embedText
  // -----------------------------------------------------------------------

  test('calls correct Vertex embedding predict URL with us-central1 default', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.vertex-token', expires_in: 3600 })
    mock.enqueueJson({
      predictions: [{ embeddings: { values: [0.1, 0.2, 0.3] } }],
    })

    const client = createVertexClient(mock.fn)
    const vector = await client.embedText(
      serviceAccountJson,
      '',
      '',
      'text-embedding-005',
      'Embed me',
      256,
    )

    expect(vector).toEqual([0.1, 0.2, 0.3])
    expect(mock.calls[1]!.url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/vertex-test-project/locations/us-central1/publishers/google/models/text-embedding-005:predict',
    )
  })

  test('sends correct embedding request body', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.test', expires_in: 3600 })
    mock.enqueueJson({
      predictions: [{ embeddings: { values: [0.1, 0.2] } }],
    })

    const client = createVertexClient(mock.fn)
    await client.embedText(
      serviceAccountJson,
      '',
      '',
      'text-embedding-005',
      'embed this',
      256,
    )

    const body = JSON.parse(mock.calls[1]!.init?.body as string)
    expect(body.instances).toEqual([{ content: 'embed this' }])
    expect(body.parameters.outputDimensionality).toBe(256)
  })

  test('omits parameters when dimensions is 0', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.test', expires_in: 3600 })
    mock.enqueueJson({
      predictions: [{ embeddings: { values: [0.1, 0.2] } }],
    })

    const client = createVertexClient(mock.fn)
    await client.embedText(
      serviceAccountJson,
      '',
      '',
      'text-embedding-005',
      'embed',
      0,
    )

    const body = JSON.parse(mock.calls[1]!.init?.body as string)
    expect(body.parameters).toBeUndefined()
  })

  test('throws on malformed embedding response', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.test', expires_in: 3600 })
    mock.enqueueJson({ wrong: 'shape' })

    const client = createVertexClient(mock.fn)
    await expect(
      client.embedText(serviceAccountJson, '', '', 'text-embedding-005', 'hi'),
    ).rejects.toThrow(/predictions/i)
  })

  test('uses explicit location for embeddings', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.test', expires_in: 3600 })
    mock.enqueueJson({
      predictions: [{ embeddings: { values: [0.1] } }],
    })

    const client = createVertexClient(mock.fn)
    await client.embedText(
      serviceAccountJson,
      '',
      'europe-west4',
      'text-embedding-005',
      'hi',
    )

    expect(mock.calls[1]!.url).toContain('europe-west4-aiplatform.googleapis.com')
    expect(mock.calls[1]!.url).toContain('/locations/europe-west4/')
  })

  // -----------------------------------------------------------------------
  // listModels
  // -----------------------------------------------------------------------

  test('lists Gemini models from publisher discovery endpoint', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.test', expires_in: 3600 })
    mock.enqueueJson({
      publisherModels: [
        { name: 'publishers/google/models/gemini-2.5-pro' },
        { name: 'publishers/google/models/gemini-2.5-flash' },
        { name: 'publishers/google/models/text-embedding-005' },
        { name: 'publishers/google/models/imagen-4.0-generate' },
      ],
    })

    const client = createVertexClient(mock.fn)
    const models = await client.listModels(serviceAccountJson)

    expect(models).toContain('gemini-2.5-pro')
    expect(models).toContain('gemini-2.5-flash')
    expect(models).not.toContain('text-embedding-005')
    expect(models).not.toContain('imagen-4.0-generate')
  })

  test('listModels calls correct discovery URL', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.test', expires_in: 3600 })
    mock.enqueueJson({ publisherModels: [] })

    const client = createVertexClient(mock.fn)
    await client.listModels(serviceAccountJson)

    expect(mock.calls[1]!.url).toBe(
      'https://aiplatform.googleapis.com/v1beta1/publishers/google/models?listAllVersions=true',
    )
  })

  test('listModels returns empty array on HTTP error', async () => {
    const mock = createMockFetch()
    mock.enqueueJson({ access_token: 'ya29.test', expires_in: 3600 })
    mock.enqueueJson({ error: 'forbidden' }, 403)

    const client = createVertexClient(mock.fn)
    const models = await client.listModels(serviceAccountJson)
    expect(models).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getSharedVertexClient
// ---------------------------------------------------------------------------

describe('getSharedVertexClient', () => {
  test('returns same client instance for same api object', () => {
    const api = {
      nativeFetch: async () => new Response(),
    } as unknown as RisuaiApi

    const c1 = getSharedVertexClient(api)
    const c2 = getSharedVertexClient(api)
    expect(c1).toBe(c2)
  })

  test('returns different client instance for different api objects', () => {
    const api1 = {
      nativeFetch: async () => new Response(),
    } as unknown as RisuaiApi
    const api2 = {
      nativeFetch: async () => new Response(),
    } as unknown as RisuaiApi

    const c1 = getSharedVertexClient(api1)
    const c2 = getSharedVertexClient(api2)
    expect(c1).not.toBe(c2)
  })
})
