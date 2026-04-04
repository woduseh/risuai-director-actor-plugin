// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

import type { RisuaiApi } from '../contracts/risuai.js'

export const GITHUB_TOKEN_EXCHANGE_URL =
  'https://api.github.com/copilot_internal/v2/token'

export const COPILOT_API_BASE = 'https://api.githubcopilot.com'

const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000 // 5 min
const DIRECT_TOKEN_TTL_MS = 30 * 60 * 1000 // 30 min

const COMMON_HEADERS: Record<string, string> = {
  'User-Agent': 'GitHubCopilotChat/1.0',
  'Editor-Version': 'vscode/1.99.0',
  'Editor-Plugin-Version': 'copilot-chat/1.0',
}

const EXCHANGE_HEADERS_BASE: Record<string, string> = {
  Accept: 'application/json',
  'X-GitHub-Api-Version': '2024-12-15',
  ...COMMON_HEADERS,
}

const INFERENCE_HEADERS_BASE: Record<string, string> = {
  'Content-Type': 'application/json',
  'Copilot-Integration-Id': 'vscode-chat',
  'X-Github-Api-Version': '2025-10-01',
  'X-Initiator': 'user',
  'X-Interaction-Type': 'conversation-panel',
  'X-Vscode-User-Agent-Library-Version': 'electron-fetch',
  ...COMMON_HEADERS,
}

// Copilot Anthropic requests require an explicit output cap. The Director only
// asks for compact JSON payloads, so 4096 is ample headroom.
const ANTHROPIC_MAX_TOKENS = 4096

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CopilotApiFormat = 'chat' | 'responses' | 'anthropic'

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export interface CopilotEndpointInfo {
  path: string
  format: CopilotApiFormat
}

export interface CopilotClient {
  getApiToken(inputToken: string): Promise<string>
  listModels(inputToken: string): Promise<string[]>
  complete(
    inputToken: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<string>
}

// ---------------------------------------------------------------------------
// Endpoint routing
// ---------------------------------------------------------------------------

// Keep this explicit until Copilot documents broader Responses API routing.
const RESPONSES_API_PATTERN = /^gpt-5\.4/
const ANTHROPIC_PATTERN = /^claude-/

export function resolveCopilotEndpoint(model: string): CopilotEndpointInfo {
  if (RESPONSES_API_PATTERN.test(model)) {
    return { path: '/responses', format: 'responses' }
  }
  if (ANTHROPIC_PATTERN.test(model)) {
    return { path: '/v1/messages', format: 'anthropic' }
  }
  return { path: '/chat/completions', format: 'chat' }
}

// ---------------------------------------------------------------------------
// Response parsers
// ---------------------------------------------------------------------------

function parseChatCompletion(json: Record<string, unknown>): string {
  const choices = json.choices as
    | Array<{ message?: { content?: string } }>
    | undefined
  const content = choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error(
      'Unexpected chat completion response: missing choices[0].message.content',
    )
  }
  return content
}

function parseResponsesApi(json: Record<string, unknown>): string {
  if (typeof json.output_text === 'string') {
    return json.output_text
  }
  const output = json.output as
    | Array<{
        type?: string
        content?: Array<{ type?: string; text?: string }>
      }>
    | undefined
  if (!Array.isArray(output)) {
    throw new Error(
      'Unexpected responses API response: missing output array',
    )
  }
  const parts: string[] = []
  for (const item of output) {
    if (Array.isArray(item.content)) {
      for (const block of item.content) {
        if (typeof block.text === 'string') {
          parts.push(block.text)
        }
      }
    }
  }
  if (parts.length === 0) {
    throw new Error(
      'Unexpected responses API response: no text content in output',
    )
  }
  return parts.join('')
}

function parseAnthropicMessages(json: Record<string, unknown>): string {
  const content = json.content as
    | Array<{ type?: string; text?: string }>
    | undefined
  if (!Array.isArray(content)) {
    throw new Error('Unexpected anthropic response: missing content array')
  }
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  if (parts.length === 0) {
    throw new Error('Unexpected anthropic response: no text content')
  }
  return parts.join('')
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

interface TokenCache {
  inputToken: string
  token: string
  apiBase: string
  expiresAt: number
}

interface ExchangeResponse {
  token?: string
  expires_at?: number
  endpoints?: {
    api?: string
  }
}

const sharedCopilotClients = new WeakMap<RisuaiApi, CopilotClient>()

export function getSharedCopilotClient(api: RisuaiApi): CopilotClient {
  const existing = sharedCopilotClients.get(api)
  if (existing) {
    return existing
  }
  const client = createCopilotClient((url, init) => api.nativeFetch(url, init))
  sharedCopilotClients.set(api, client)
  return client
}

export function createCopilotClient(fetchFn: FetchFn): CopilotClient {
  const cacheByInputToken = new Map<string, TokenCache>()
  const inflightByInputToken = new Map<string, Promise<TokenCache>>()

  function normalizeApiBase(apiBase?: string): string {
    if (typeof apiBase !== 'string' || apiBase.trim().length === 0) {
      return COPILOT_API_BASE
    }
    return apiBase.trim().replace(/\/+$/, '')
  }

  async function throwHttpError(
    prefix: string,
    response: Response,
  ): Promise<never> {
    let detail = ''
    try {
      const text = (await response.text()).trim()
      if (text) {
        detail = text.length > 200 ? `${text.slice(0, 200)}...` : text
      }
    } catch {
      // Ignore body read failures; the status line is still actionable.
    }
    throw new Error(
      `${prefix} (HTTP ${String(response.status)})${detail ? `: ${detail}` : ''}`,
    )
  }

  async function exchangeToken(inputToken: string): Promise<TokenCache> {
    const response = await fetchFn(GITHUB_TOKEN_EXCHANGE_URL, {
      method: 'GET',
      headers: {
        ...EXCHANGE_HEADERS_BASE,
        Authorization: `Bearer ${inputToken}`,
      },
    })

    if (response.status === 401 || response.status === 403) {
      return {
        inputToken,
        token: inputToken,
        apiBase: COPILOT_API_BASE,
        expiresAt: Date.now() + DIRECT_TOKEN_TTL_MS,
      }
    }

    if (!response.ok) {
      return throwHttpError('Copilot token exchange failed', response)
    }

    const data = (await response.json()) as ExchangeResponse
    if (
      typeof data.token !== 'string' ||
      typeof data.expires_at !== 'number'
    ) {
      throw new Error(
        'Copilot token exchange returned unexpected response',
      )
    }

    return {
      inputToken,
      token: data.token,
      apiBase: normalizeApiBase(data.endpoints?.api),
      expiresAt: data.expires_at * 1000 - TOKEN_EXPIRY_SAFETY_MARGIN_MS,
    }
  }

  async function getApiAccess(inputToken: string): Promise<TokenCache> {
    const cached = cacheByInputToken.get(inputToken)
    if (cached && cached.expiresAt > Date.now()) {
      return cached
    }

    const inflight = inflightByInputToken.get(inputToken)
    if (inflight) {
      return inflight
    }

    const next = exchangeToken(inputToken).finally(() => {
      inflightByInputToken.delete(inputToken)
    })
    inflightByInputToken.set(inputToken, next)

    const resolved = await next
    cacheByInputToken.set(inputToken, resolved)
    return resolved
  }

  async function getApiToken(inputToken: string): Promise<string> {
    return (await getApiAccess(inputToken)).token
  }

  function inferenceHeaders(
    apiToken: string,
    format?: CopilotApiFormat,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      ...INFERENCE_HEADERS_BASE,
      Authorization: `Bearer ${apiToken}`,
    }
    if (format === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01'
    }
    return headers
  }

  async function listModels(inputToken: string): Promise<string[]> {
    const access = await getApiAccess(inputToken)

    const response = await fetchFn(`${access.apiBase}/models`, {
      method: 'GET',
      headers: inferenceHeaders(access.token),
    })

    if (!response.ok) {
      return throwHttpError('Copilot model listing failed', response)
    }

    const json = (await response.json()) as {
      data?: Array<{ id: string; [key: string]: unknown }>
    }
    const ids = (json.data ?? []).map((entry) => entry.id)
    return [...new Set(ids)].sort()
  }

  async function complete(
    inputToken: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    const access = await getApiAccess(inputToken)
    const { path, format } = resolveCopilotEndpoint(model)

    let body: string
    if (format === 'anthropic') {
      const systemParts = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
      const nonSystem = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content }))
      body = JSON.stringify({
        model,
        ...(systemParts.length > 0
          ? { system: systemParts.join('\n') }
          : {}),
        messages: nonSystem,
        max_tokens: ANTHROPIC_MAX_TOKENS,
      })
    } else if (format === 'responses') {
      body = JSON.stringify({
        model,
        input: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
      })
    } else {
      body = JSON.stringify({
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: false,
      })
    }

    const response = await fetchFn(`${access.apiBase}${path}`, {
      method: 'POST',
      headers: inferenceHeaders(access.token, format),
      body,
    })

    if (!response.ok) {
      return throwHttpError('Copilot inference failed', response)
    }

    const json = (await response.json()) as Record<string, unknown>

    switch (format) {
      case 'chat':
        return parseChatCompletion(json)
      case 'responses':
        return parseResponsesApi(json)
      case 'anthropic':
        return parseAnthropicMessages(json)
    }
  }

  return { getApiToken, listModels, complete }
}
