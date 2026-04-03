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
})
