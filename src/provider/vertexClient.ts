import type { RisuaiApi } from '../contracts/risuai.js'

export const GCP_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const VERTEX_GLOBAL_API_BASE = 'https://aiplatform.googleapis.com'
const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60 * 1000
const VERTEX_MODEL_LIST_URL =
  'https://aiplatform.googleapis.com/v1beta1/publishers/google/models?listAllVersions=true'

export interface VertexServiceAccount {
  project_id?: string
  client_email: string
  private_key: string
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export interface VertexClient {
  getAccessToken(serviceAccountJson: string): Promise<string>
  listModels(serviceAccountJson: string): Promise<string[]>
  complete(
    serviceAccountJson: string,
    projectOverride: string,
    locationOverride: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<string>
  embedText(
    serviceAccountJson: string,
    projectOverride: string,
    locationOverride: string,
    model: string,
    text: string,
    dimensions?: number,
  ): Promise<number[]>
}

interface TokenCache {
  token: string
  expiresAt: number
}

interface GoogleTokenResponse {
  access_token?: string
  expires_in?: number
}

const sharedVertexClients = new WeakMap<RisuaiApi, VertexClient>()

export function getSharedVertexClient(api: RisuaiApi): VertexClient {
  const existing = sharedVertexClients.get(api)
  if (existing) {
    return existing
  }
  const client = createVertexClient((url, init) => api.nativeFetch(url, init))
  sharedVertexClients.set(api, client)
  return client
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function textToBase64Url(text: string): string {
  return bytesToBase64Url(new TextEncoder().encode(text))
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const normalized = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

async function buildJwt(serviceAccount: VertexServiceAccount): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000)
  const header = textToBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = textToBase64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: GCP_OAUTH_TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  )
  const unsignedToken = `${header}.${claims}`

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(serviceAccount.private_key),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(unsignedToken),
  )
  return `${unsignedToken}.${bytesToBase64Url(new Uint8Array(signature))}`
}

async function throwHttpError(prefix: string, response: Response): Promise<never> {
  let detail = ''
  try {
    const text = (await response.text()).trim()
    if (text) {
      detail = text.length > 200 ? `${text.slice(0, 200)}...` : text
    }
  } catch {
    // Ignore body read failures; the HTTP status still provides context.
  }
  throw new Error(
    `${prefix} (HTTP ${String(response.status)})${detail ? `: ${detail}` : ''}`,
  )
}

function resolveVertexProject(
  serviceAccount: VertexServiceAccount,
  override: string,
): string {
  const project = override.trim() || serviceAccount.project_id?.trim() || ''
  if (!project) {
    throw new Error('Vertex project is not configured')
  }
  return project
}

function resolveDirectorLocation(locationOverride: string): string {
  const location = locationOverride.trim()
  return location || 'global'
}

function resolveEmbeddingLocation(locationOverride: string): string {
  const location = locationOverride.trim()
  return location || 'us-central1'
}

function isGeminiModel(model: string): boolean {
  return /^gemini-/i.test(model)
}

function extractGeminiText(json: Record<string, unknown>): string {
  const candidates = json.candidates as
    | Array<{ content?: { parts?: Array<{ text?: string }> } }>
    | undefined
  const parts = candidates?.[0]?.content?.parts ?? []
  const texts = parts
    .map((part) => part.text)
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
  if (texts.length === 0) {
    throw new Error('Unexpected Vertex Gemini response: missing candidates[0].content.parts[].text')
  }
  return texts.join('')
}

function extractEmbeddingVector(json: Record<string, unknown>): number[] {
  const predictions = json.predictions as
    | Array<{ embeddings?: { values?: number[] } }>
    | undefined
  const vector = predictions?.[0]?.embeddings?.values
  if (!Array.isArray(vector)) {
    throw new Error('Unexpected Vertex embedding response: missing predictions[0].embeddings.values')
  }
  return vector
}

function extractPublisherModelId(entry: Record<string, unknown>): string | null {
  const candidate =
    (typeof entry.name === 'string' && entry.name) ||
    (typeof entry.publisherModelTemplate === 'string' &&
      entry.publisherModelTemplate.replace(/\{[^}]+\}/g, ''))
  if (!candidate) {
    return null
  }
  const trimmed = candidate.replace(/\/+$/, '')
  const parts = trimmed.split('/')
  const modelId = parts[parts.length - 1] ?? ''
  if (!modelId || !isGeminiModel(modelId) || /embedding/i.test(modelId)) {
    return null
  }
  return modelId
}

function buildGeminiContents(messages: Array<{ role: string; content: string }>) {
  const systemMessages = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .filter((content) => content.length > 0)
  const contents = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }))

  return {
    contents,
    ...(systemMessages.length > 0
      ? {
          systemInstruction: {
            parts: [{ text: systemMessages.join('\n') }],
          },
        }
      : {}),
  }
}

export function parseServiceAccountJson(serviceAccountJson: string): VertexServiceAccount {
  const trimmed = serviceAccountJson.trim()
  if (!trimmed) {
    throw new Error('Vertex JSON key is empty')
  }
  if (/^[A-Za-z]:\\/.test(trimmed) || /^\\\\/.test(trimmed) || trimmed.startsWith('/')) {
    throw new Error('Vertex JSON key must be pasted directly, not provided as a file path')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Vertex JSON key is invalid: ${message}`)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Vertex JSON key must be a JSON object')
  }

  const account = parsed as Record<string, unknown>
  if (typeof account.client_email !== 'string' || account.client_email.trim() === '') {
    throw new Error('Vertex JSON key is missing client_email')
  }
  if (typeof account.private_key !== 'string' || account.private_key.trim() === '') {
    throw new Error('Vertex JSON key is missing private_key')
  }
  if (
    !account.private_key.includes('-----BEGIN') ||
    !account.private_key.includes('PRIVATE KEY-----')
  ) {
    throw new Error('Vertex JSON key private_key is not a PEM-formatted PKCS#8 key')
  }

  const result: VertexServiceAccount = {
    client_email: account.client_email,
    private_key: account.private_key,
  }
  if (typeof account.project_id === 'string') {
    result.project_id = account.project_id
  }

  return result
}

export function resolveVertexApiBase(location: string): string {
  if (location === 'global') {
    return VERTEX_GLOBAL_API_BASE
  }
  return `https://${location}-aiplatform.googleapis.com`
}

export function createVertexClient(
  fetchFn: FetchFn,
): VertexClient {
  const tokenCache = new Map<string, TokenCache>()
  const inflight = new Map<string, Promise<string>>()

  async function exchangeAccessToken(serviceAccountJson: string): Promise<string> {
    const serviceAccount = parseServiceAccountJson(serviceAccountJson)
    const cacheKey = serviceAccount.client_email
    const cached = tokenCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token
    }

    const pending = inflight.get(cacheKey)
    if (pending) {
      return pending
    }

    const next = (async () => {
      const jwt = await buildJwt(serviceAccount)
      const response = await fetchFn(GCP_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body:
          'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer' +
          `&assertion=${encodeURIComponent(jwt)}`,
      })

      if (!response.ok) {
        return throwHttpError('Vertex token exchange failed', response)
      }

      const json = (await response.json()) as GoogleTokenResponse
      if (
        typeof json.access_token !== 'string' ||
        typeof json.expires_in !== 'number'
      ) {
        throw new Error('Vertex token exchange returned an unexpected response')
      }

      tokenCache.set(cacheKey, {
        token: json.access_token,
        expiresAt:
          Date.now() +
          json.expires_in * 1000 -
          TOKEN_EXPIRY_SAFETY_MARGIN_MS,
      })
      return json.access_token
    })().finally(() => {
      inflight.delete(cacheKey)
    })

    inflight.set(cacheKey, next)
    return next
  }

  function invalidateToken(serviceAccountJson: string): void {
    const serviceAccount = parseServiceAccountJson(serviceAccountJson)
    tokenCache.delete(serviceAccount.client_email)
  }

  async function getAccessToken(serviceAccountJson: string): Promise<string> {
    return exchangeAccessToken(serviceAccountJson)
  }

  async function listModels(serviceAccountJson: string): Promise<string[]> {
    const accessToken = await getAccessToken(serviceAccountJson)
    const response = await fetchFn(VERTEX_MODEL_LIST_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (response.status === 401 || response.status === 403) {
      invalidateToken(serviceAccountJson)
    }
    if (!response.ok) {
      return []
    }

    const json = (await response.json()) as {
      publisherModels?: Array<Record<string, unknown>>
    }
    const ids = (json.publisherModels ?? [])
      .map(extractPublisherModelId)
      .filter((modelId): modelId is string => typeof modelId === 'string')
    return [...new Set(ids)].sort()
  }

  async function complete(
    serviceAccountJson: string,
    projectOverride: string,
    locationOverride: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    if (!isGeminiModel(model)) {
      throw new Error('Vertex provider currently supports Gemini models only')
    }

    const serviceAccount = parseServiceAccountJson(serviceAccountJson)
    const project = resolveVertexProject(serviceAccount, projectOverride)
    const location = resolveDirectorLocation(locationOverride)
    const accessToken = await getAccessToken(serviceAccountJson)
    const response = await fetchFn(
      `${resolveVertexApiBase(location)}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...buildGeminiContents(messages),
          generationConfig: {},
        }),
      },
    )

    if (response.status === 401 || response.status === 403) {
      invalidateToken(serviceAccountJson)
    }
    if (!response.ok) {
      return throwHttpError('Vertex inference failed', response)
    }

    return extractGeminiText((await response.json()) as Record<string, unknown>)
  }

  async function embedText(
    serviceAccountJson: string,
    projectOverride: string,
    locationOverride: string,
    model: string,
    text: string,
    dimensions = 0,
  ): Promise<number[]> {
    const serviceAccount = parseServiceAccountJson(serviceAccountJson)
    const project = resolveVertexProject(serviceAccount, projectOverride)
    const location = resolveEmbeddingLocation(locationOverride)
    const accessToken = await getAccessToken(serviceAccountJson)
    const response = await fetchFn(
      `${resolveVertexApiBase(location)}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instances: [{ content: text }],
          ...(dimensions > 0
            ? { parameters: { outputDimensionality: dimensions } }
            : {}),
        }),
      },
    )

    if (response.status === 401 || response.status === 403) {
      invalidateToken(serviceAccountJson)
    }
    if (!response.ok) {
      return throwHttpError('Vertex embedding request failed', response)
    }

    return extractEmbeddingVector(
      (await response.json()) as Record<string, unknown>,
    )
  }

  return {
    getAccessToken,
    listModels,
    complete,
    embedText,
  }
}
