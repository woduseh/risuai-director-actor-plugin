// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
  token: string
  expiresAt: number
}

interface ExchangeResponse {
  token?: string
  expires_at?: number
}

export function createCopilotClient(fetchFn: FetchFn): CopilotClient {
  let cached: TokenCache | null = null
  let inflight: Promise<string> | null = null

  async function exchangeToken(inputToken: string): Promise<string> {
    const response = await fetchFn(GITHUB_TOKEN_EXCHANGE_URL, {
      method: 'GET',
      headers: {
        ...EXCHANGE_HEADERS_BASE,
        Authorization: `Bearer ${inputToken}`,
      },
    })

    if (response.status === 401 || response.status === 403) {
      cached = {
        token: inputToken,
        expiresAt: Date.now() + DIRECT_TOKEN_TTL_MS,
      }
      return inputToken
    }

    if (!response.ok) {
      throw new Error(
        `Copilot token exchange failed (HTTP ${String(response.status)})`,
      )
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

    cached = {
      token: data.token,
      expiresAt: data.expires_at * 1000 - TOKEN_EXPIRY_SAFETY_MARGIN_MS,
    }
    return data.token
  }

  async function getApiToken(inputToken: string): Promise<string> {
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token
    }

    if (inflight) return inflight

    inflight = exchangeToken(inputToken).finally(() => {
      inflight = null
    })
    return inflight
  }

  function inferenceHeaders(apiToken: string): Record<string, string> {
    return {
      ...INFERENCE_HEADERS_BASE,
      Authorization: `Bearer ${apiToken}`,
    }
  }

  async function listModels(inputToken: string): Promise<string[]> {
    const apiToken = await getApiToken(inputToken)

    const response = await fetchFn(`${COPILOT_API_BASE}/models`, {
      method: 'GET',
      headers: inferenceHeaders(apiToken),
    })

    if (!response.ok) {
      throw new Error(
        `Copilot model listing failed (HTTP ${String(response.status)})`,
      )
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
    const apiToken = await getApiToken(inputToken)
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

    const response = await fetchFn(`${COPILOT_API_BASE}${path}`, {
      method: 'POST',
      headers: inferenceHeaders(apiToken),
      body,
    })

    if (!response.ok) {
      throw new Error(
        `Copilot inference failed (HTTP ${String(response.status)})`,
      )
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
