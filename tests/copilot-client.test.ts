import { describe, test, expect } from 'vitest'
import {
  resolveCopilotEndpoint,
  createCopilotClient,
  GITHUB_TOKEN_EXCHANGE_URL,
  COPILOT_API_BASE,
  type FetchFn,
} from '../src/provider/copilotClient.js'

// ---------------------------------------------------------------------------
// Mock fetch helper
// ---------------------------------------------------------------------------

function createMockFetch() {
  const calls: Array<{ url: string; init?: RequestInit | undefined }> = []
  const queue: Response[] = []

  const fn: FetchFn = async (url, init) => {
    calls.push({ url, init })
    const resp = queue.shift()
    if (!resp) throw new Error('Mock fetch queue exhausted')
    return resp
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
// Fixtures
// ---------------------------------------------------------------------------

function makeExchangeResponse(
  overrides?: Partial<{ token: string; expires_at: number }>,
) {
  return {
    token: overrides?.token ?? 'tid=copilot-api-token-abc123',
    expires_at:
      overrides?.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
  }
}

// ---------------------------------------------------------------------------
// resolveCopilotEndpoint
// ---------------------------------------------------------------------------

describe('resolveCopilotEndpoint', () => {
  test('routes standard GPT and o-series models to /chat/completions', () => {
    for (const model of ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'o3', 'o3-mini']) {
      expect(resolveCopilotEndpoint(model)).toEqual({
        path: '/chat/completions',
        format: 'chat',
      })
    }
  })

  test('routes GPT-5.4 family to /responses', () => {
    for (const model of ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4-pro']) {
      expect(resolveCopilotEndpoint(model)).toEqual({
        path: '/responses',
        format: 'responses',
      })
    }
  })

  test('routes Claude models to /v1/messages', () => {
    for (const model of [
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'claude-3-5-sonnet-latest',
    ]) {
      expect(resolveCopilotEndpoint(model)).toEqual({
        path: '/v1/messages',
        format: 'anthropic',
      })
    }
  })

  test('defaults unknown models to /chat/completions', () => {
    expect(resolveCopilotEndpoint('unknown-model-x')).toEqual({
      path: '/chat/completions',
      format: 'chat',
    })
  })
})

// ---------------------------------------------------------------------------
// CopilotClient – getApiToken
// ---------------------------------------------------------------------------

describe('CopilotClient', () => {
  describe('getApiToken', () => {
    test('exchanges input token via GitHub API and returns copilot API token', async () => {
      const mock = createMockFetch()
      mock.enqueueJson(makeExchangeResponse())

      const client = createCopilotClient(mock.fn)
      const token = await client.getApiToken('ghp_inputtoken123')

      expect(token).toBe('tid=copilot-api-token-abc123')
      expect(mock.calls).toHaveLength(1)
      expect(mock.calls[0]!.url).toBe(GITHUB_TOKEN_EXCHANGE_URL)
      expect(mock.calls[0]!.init?.method).toBe('GET')
    })

    test('sends correct headers for token exchange', async () => {
      const mock = createMockFetch()
      mock.enqueueJson(makeExchangeResponse())

      const client = createCopilotClient(mock.fn)
      await client.getApiToken('ghp_inputtoken123')

      const headers = mock.calls[0]!.init?.headers as Record<string, string>
      expect(headers['Authorization']).toBe('Bearer ghp_inputtoken123')
      expect(headers['Accept']).toBe('application/json')
      expect(headers['X-GitHub-Api-Version']).toBe('2024-12-15')
      expect(headers['User-Agent']).toBeDefined()
    })

    test('caches exchanged token and reuses on subsequent calls', async () => {
      const mock = createMockFetch()
      mock.enqueueJson(makeExchangeResponse())

      const client = createCopilotClient(mock.fn)
      const t1 = await client.getApiToken('ghp_test')
      const t2 = await client.getApiToken('ghp_test')

      expect(t1).toBe(t2)
      expect(mock.calls).toHaveLength(1)
    })

    test('re-exchanges when cached token has expired', async () => {
      const mock = createMockFetch()
      // First exchange returns already-expired token
      mock.enqueueJson(
        makeExchangeResponse({
          token: 'tid=first',
          expires_at: Math.floor(Date.now() / 1000) - 100,
        }),
      )
      // Second exchange returns fresh token
      mock.enqueueJson(makeExchangeResponse({ token: 'tid=second' }))

      const client = createCopilotClient(mock.fn)
      const t1 = await client.getApiToken('ghp_test')
      expect(t1).toBe('tid=first')

      const t2 = await client.getApiToken('ghp_test')
      expect(t2).toBe('tid=second')
      expect(mock.calls).toHaveLength(2)
    })

    test('single-flights concurrent exchange requests', async () => {
      const mock = createMockFetch()
      mock.enqueueJson(makeExchangeResponse())

      const client = createCopilotClient(mock.fn)
      const [t1, t2] = await Promise.all([
        client.getApiToken('ghp_test'),
        client.getApiToken('ghp_test'),
      ])

      expect(t1).toBe(t2)
      expect(mock.calls).toHaveLength(1)
    })

    test('falls back to direct token when exchange returns 401 or 403', async () => {
      for (const status of [401, 403]) {
        const mock = createMockFetch()
        mock.enqueueJson({ message: 'Unauthorized' }, status)

        const client = createCopilotClient(mock.fn)
        const token = await client.getApiToken('tid=direct-token')

        expect(token).toBe('tid=direct-token')
      }
    })

    test('caches direct-token fallback across calls', async () => {
      const mock = createMockFetch()
      mock.enqueueJson({ message: 'Unauthorized' }, 401)

      const client = createCopilotClient(mock.fn)
      const t1 = await client.getApiToken('tid=direct')
      const t2 = await client.getApiToken('tid=direct')

      expect(t1).toBe(t2)
      expect(mock.calls).toHaveLength(1)
    })

    test('throws on non-auth exchange HTTP errors', async () => {
      const mock = createMockFetch()
      mock.enqueueJson({ message: 'Server error' }, 500)

      const client = createCopilotClient(mock.fn)
      await expect(client.getApiToken('ghp_test')).rejects.toThrow(
        /token exchange failed/i,
      )
    })
  })

  // -----------------------------------------------------------------------
  // listModels
  // -----------------------------------------------------------------------

  describe('listModels', () => {
    test('fetches models from /models with exchanged token and returns sorted IDs', async () => {
      const mock = createMockFetch()
      mock.enqueueJson(makeExchangeResponse())
      mock.enqueueJson({
        data: [
          { id: 'gpt-5.4', capabilities: {} },
          { id: 'gpt-4.1', capabilities: {} },
          { id: 'claude-sonnet-4-6', capabilities: {} },
        ],
      })

      const client = createCopilotClient(mock.fn)
      const models = await client.listModels('ghp_test')

      expect(models).toEqual(['claude-sonnet-4-6', 'gpt-4.1', 'gpt-5.4'])

      const modelsCall = mock.calls[1]!
      expect(modelsCall.url).toBe(`${COPILOT_API_BASE}/models`)
      const headers = modelsCall.init?.headers as Record<string, string>
      expect(headers['Authorization']).toBe(
        'Bearer tid=copilot-api-token-abc123',
      )
    })

    test('throws on HTTP error from /models endpoint', async () => {
      const mock = createMockFetch()
      mock.enqueueJson(makeExchangeResponse())
      mock.enqueueJson({ error: 'forbidden' }, 403)

      const client = createCopilotClient(mock.fn)
      await expect(client.listModels('ghp_test')).rejects.toThrow(
        /model listing failed/i,
      )
    })
  })

  // -----------------------------------------------------------------------
  // complete
  // -----------------------------------------------------------------------

  describe('complete', () => {
    test('sends /chat/completions for GPT-4.1 and parses content', async () => {
      const mock = createMockFetch()
      mock.enqueueJson(makeExchangeResponse())
      mock.enqueueJson({
        choices: [
          { message: { role: 'assistant', content: 'Hello from GPT' } },
        ],
      })

      const client = createCopilotClient(mock.fn)
      const text = await client.complete('ghp_test', 'gpt-4.1', [
        { role: 'user', content: 'Hi' },
      ])

      expect(text).toBe('Hello from GPT')

      const call = mock.calls[1]!
      expect(call.url).toBe(`${COPILOT_API_BASE}/chat/completions`)
      const body = JSON.parse(call.init?.body as string)
      expect(body.model).toBe('gpt-4.1')
      expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }])
    })

    test('sends /responses for GPT-5.4 and aggregates output text', async () => {
      const mock = createMockFetch()
      mock.enqueueJson(makeExchangeResponse())
      mock.enqueueJson({
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: 'Part A ' },
              { type: 'output_text', text: 'Part B' },
            ],
          },
        ],
      })

      const client = createCopilotClient(mock.fn)
      const text = await client.complete('ghp_test', 'gpt-5.4', [
        { role: 'user', content: 'Hi' },
      ])

      expect(text).toBe('Part A Part B')

      const call = mock.calls[1]!
      expect(call.url).toBe(`${COPILOT_API_BASE}/responses`)
      const body = JSON.parse(call.init?.body as string)
      expect(body.model).toBe('gpt-5.4')
      expect(body.input).toBeDefined()
    })

    test('uses output_text shorthand from responses API when available', async () => {
      const mock = createMockFetch()
      mock.enqueueJson(makeExchangeResponse())
      mock.enqueueJson({
        output_text: 'Direct text shorthand',
        output: [],
      })

      const client = createCopilotClient(mock.fn)
      const text = await client.complete('ghp_test', 'gpt-5.4', [
        { role: 'user', content: 'Hi' },
      ])

      expect(text).toBe('Direct text shorthand')
    })

    test('sends /v1/messages for Claude with system extraction', async () => {
      const mock = createMockFetch()
      mock.enqueueJson(makeExchangeResponse())
      mock.enqueueJson({
        content: [{ type: 'text', text: 'Hello from Claude' }],
      })

      const client = createCopilotClient(mock.fn)
      const text = await client.complete('ghp_test', 'claude-sonnet-4-6', [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
      ])

      expect(text).toBe('Hello from Claude')

      const call = mock.calls[1]!
      expect(call.url).toBe(`${COPILOT_API_BASE}/v1/messages`)
      const body = JSON.parse(call.init?.body as string)
      expect(body.model).toBe('claude-sonnet-4-6')
      expect(body.system).toBe('You are helpful.')
      expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }])
      expect(body.max_tokens).toBeGreaterThan(0)
    })

    test('includes Copilot inference headers', async () => {
      const mock = createMockFetch()
      mock.enqueueJson(makeExchangeResponse())
      mock.enqueueJson({
        choices: [{ message: { content: 'OK' } }],
      })

      const client = createCopilotClient(mock.fn)
      await client.complete('ghp_test', 'gpt-4.1', [
        { role: 'user', content: 'Hi' },
      ])

      const headers = mock.calls[1]!.init?.headers as Record<string, string>
      expect(headers['Authorization']).toBe(
        'Bearer tid=copilot-api-token-abc123',
      )
      expect(headers['Content-Type']).toBe('application/json')
      expect(headers['Copilot-Integration-Id']).toBe('vscode-chat')
      expect(headers['X-Github-Api-Version']).toBe('2025-10-01')
    })

    test('throws on non-ok inference response', async () => {
      const mock = createMockFetch()
      mock.enqueueJson(makeExchangeResponse())
      mock.enqueueJson({ error: { message: 'Rate limited' } }, 429)

      const client = createCopilotClient(mock.fn)

      await expect(
        client.complete('ghp_test', 'gpt-4.1', [
          { role: 'user', content: 'Hi' },
        ]),
      ).rejects.toThrow(/inference failed/i)
    })
  })
})
