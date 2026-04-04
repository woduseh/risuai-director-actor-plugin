import { createMockRisuaiApi } from './helpers/mockRisuai.js'
import {
  DIRECTOR_PROVIDER_CATALOG,
  loadProviderModels,
  resolveProviderDefaults,
  testDirectorConnection
} from '../src/ui/dashboardModel.js'
import { normalizePersistedSettings } from '../src/ui/dashboardState.js'

describe('dashboardModel', () => {
  test('defines supported provider catalog entries', () => {
    expect(DIRECTOR_PROVIDER_CATALOG.map((entry: { id: string }) => entry.id)).toEqual(
      expect.arrayContaining(['openai', 'anthropic', 'google', 'custom'])
    )
  })

  test('includes copilot and vertex providers plus latest curated model families', () => {
    expect(DIRECTOR_PROVIDER_CATALOG.map((entry: { id: string }) => entry.id)).toEqual(
      expect.arrayContaining(['openai', 'anthropic', 'google', 'copilot', 'vertex', 'custom'])
    )

    const openai = resolveProviderDefaults('openai') as unknown as Record<string, unknown>
    const anthropic = resolveProviderDefaults('anthropic') as unknown as Record<string, unknown>
    const google = resolveProviderDefaults('google') as unknown as Record<string, unknown>
    const copilot = resolveProviderDefaults(
      'copilot' as unknown as Parameters<typeof resolveProviderDefaults>[0]
    ) as unknown as Record<string, unknown>
    const vertex = resolveProviderDefaults(
      'vertex' as unknown as Parameters<typeof resolveProviderDefaults>[0]
    ) as unknown as Record<string, unknown>

    expect(openai.curatedModels).toEqual(expect.arrayContaining(['gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-nano']))
    expect(anthropic.curatedModels).toEqual(expect.arrayContaining(['claude-opus-4-6', 'claude-sonnet-4-6']))
    expect(google.curatedModels).toEqual(expect.arrayContaining(['gemini-3.1-pro-preview', 'gemini-3.1-pro-preview-customtools', 'gemini-3.1-flash-lite-preview']))
    expect(copilot.label).toBe('GitHub Copilot')
    expect(copilot.authMode).toBe('oauth-device-flow')
    expect(copilot.curatedModels).toEqual(expect.arrayContaining(['gpt-5.4']))
    expect(vertex.label).toBe('Google Vertex AI')
    expect(vertex.authMode).toBe('manual-advanced')
  })

  test('resolves provider defaults for openai', () => {
    const defaults = resolveProviderDefaults('openai')

    expect(defaults.baseUrl).toBe('https://api.openai.com/v1')
    expect(defaults.manualModelOnly).toBe(false)
  })

  test('loads model ids from an openai-compatible models response', async () => {
    const api = createMockRisuaiApi()
    api.enqueueNativeFetchJson({
      data: [{ id: 'gpt-4.1-mini' }, { id: 'gpt-4.1' }]
    })

    const models = await loadProviderModels(
      api,
      normalizePersistedSettings({
        directorProvider: 'openai',
        directorApiKey: 'sk-test',
        directorBaseUrl: 'https://api.openai.com/v1'
      })
    )

    expect(models).toEqual(['gpt-4.1', 'gpt-4.1-mini'])
  })

  test('returns provider-managed fallback suggestions when a provider has no model listing endpoint', async () => {
    const api = createMockRisuaiApi()

    const models = await loadProviderModels(
      api,
      normalizePersistedSettings({
        directorProvider: 'anthropic',
        directorApiKey: 'test-key'
      })
    )

    expect(models.length).toBeGreaterThan(0)
    expect(models.some((entry: string) => entry.includes('claude'))).toBe(true)
  })

  test('returns latest curated Google model suggestions when listing is provider-managed', async () => {
    const api = createMockRisuaiApi()

    const models = await loadProviderModels(
      api,
      normalizePersistedSettings({
        directorProvider: 'google',
        directorApiKey: 'test-key'
      })
    )

    expect(models).toEqual(expect.arrayContaining(['gemini-3.1-pro-preview']))
  })

  test('tests openai-compatible connectivity with nativeFetch', async () => {
    const api = createMockRisuaiApi()
    api.enqueueNativeFetchJson({
      data: [{ id: 'gpt-4.1-mini' }]
    })

    const result = await testDirectorConnection(
      api,
      normalizePersistedSettings({
        directorProvider: 'openai',
        directorApiKey: 'sk-test',
        directorBaseUrl: 'https://api.openai.com/v1'
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.models).toContain('gpt-4.1-mini')
  })

  test('returns error for Copilot connection test when token is not configured', async () => {
    const api = createMockRisuaiApi()

    const result = await testDirectorConnection(
      api,
      normalizePersistedSettings({
        directorProvider: 'copilot',
        directorCopilotToken: '',
      })
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/token/i)
  })

  test('tests Copilot connection with real auth check when token is set', async () => {
    const api = createMockRisuaiApi()
    // Token exchange
    api.enqueueNativeFetchJson({
      token: 'tid=test-copilot-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    })
    // Model list
    api.enqueueNativeFetchJson({
      data: [{ id: 'gpt-4.1' }, { id: 'gpt-5.4' }],
    })

    const result = await testDirectorConnection(
      api,
      normalizePersistedSettings({
        directorProvider: 'copilot',
        directorCopilotToken: 'ghp_test123',
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.models).toContain('gpt-4.1')
  })

  test('returns error for Copilot connection test when auth fails', async () => {
    const api = createMockRisuaiApi()
    // Token exchange fails hard
    api.enqueueNativeFetchJson({ message: 'Server error' }, { status: 500 })

    const result = await testDirectorConnection(
      api,
      normalizePersistedSettings({
        directorProvider: 'copilot',
        directorCopilotToken: 'ghp_bad_token',
      })
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBeTruthy()
  })

  test('loads Copilot models dynamically when token is configured', async () => {
    const api = createMockRisuaiApi()
    // Token exchange
    api.enqueueNativeFetchJson({
      token: 'tid=test-copilot-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    })
    // Model list
    api.enqueueNativeFetchJson({
      data: [
        { id: 'gpt-5.4' },
        { id: 'gpt-4.1' },
        { id: 'claude-sonnet-4-6' },
      ],
    })

    const models = await loadProviderModels(
      api,
      normalizePersistedSettings({
        directorProvider: 'copilot',
        directorCopilotToken: 'ghp_test123',
      })
    )

    expect(models).toEqual(['claude-sonnet-4-6', 'gpt-4.1', 'gpt-5.4'])
  })

  test('falls back to curated Copilot models when token is not set', async () => {
    const api = createMockRisuaiApi()

    const models = await loadProviderModels(
      api,
      normalizePersistedSettings({
        directorProvider: 'copilot',
        directorCopilotToken: '',
      })
    )

    expect(models.length).toBeGreaterThan(0)
    expect(models).toEqual(expect.arrayContaining(['gpt-4.1']))
  })

  test('falls back to curated Copilot models when listing fails', async () => {
    const api = createMockRisuaiApi()
    // Token exchange fails
    api.enqueueNativeFetchJson({ message: 'error' }, { status: 500 })

    const models = await loadProviderModels(
      api,
      normalizePersistedSettings({
        directorProvider: 'copilot',
        directorCopilotToken: 'ghp_test123',
      })
    )

    expect(models.length).toBeGreaterThan(0)
    expect(models).toEqual(expect.arrayContaining(['gpt-4.1']))
  })
})
