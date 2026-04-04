import { createPluginBanner } from '../src/build/banner.js'

describe('createPluginBanner', () => {
  test('emits importer-compatible Plugin V3 metadata', () => {
    const banner = createPluginBanner({
      name: 'risuai-continuity-director-plugin',
      displayName: 'RisuAI Continuity Director',
      version: '0.1.0',
      description: 'Narrative guidance and long-memory continuity plugin for RisuAI Plugin V3'
    })

    const lines = banner.trimEnd().split('\n')

    expect(lines[0]).toBe('//@name risuai-continuity-director-plugin')
    expect(lines[1]).toBe('//@display-name RisuAI Continuity Director')
    expect(lines).toContain('//@api 3.0')
    expect(lines).not.toContain('//@api 3')
    expect(lines.findIndex((line: string) => line.startsWith('//@version '))).toBeLessThan(5)
  })
})
