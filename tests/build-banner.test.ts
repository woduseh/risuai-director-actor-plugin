import { createPluginBanner } from '../src/build/banner.js'

describe('createPluginBanner', () => {
  test('emits importer-compatible Plugin V3 metadata', () => {
    const banner = createPluginBanner({
      name: 'risuai-director-actor-plugin',
      displayName: 'RisuAI Director Actor',
      version: '0.1.0',
      description: 'Director-Actor collaborative long-memory plugin for RisuAI Plugin V3'
    })

    const lines = banner.trimEnd().split('\n')

    expect(lines[0]).toBe('//@name risuai-director-actor-plugin')
    expect(lines[1]).toBe('//@display-name RisuAI Director Actor')
    expect(lines).toContain('//@api 3.0')
    expect(lines).not.toContain('//@api 3')
    expect(lines.findIndex((line: string) => line.startsWith('//@version '))).toBeLessThan(5)
  })
})
