import { readFile, mkdir, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { createPluginBanner } from './src/build/banner.js'

const packageJson = JSON.parse(
  await readFile(new URL('./package.json', import.meta.url), 'utf8')
)

const banner = createPluginBanner({
  name: 'risuai-continuity-director-plugin',
  displayName: 'RisuAI Continuity Director',
  version: packageJson.version,
  description: 'Narrative guidance and long-memory continuity plugin for RisuAI Plugin V3'
})

await rm(new URL('./dist', import.meta.url), { recursive: true, force: true })
await mkdir(new URL('./dist', import.meta.url), { recursive: true })

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/risuai-continuity-director-plugin.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: false,
  legalComments: 'none',
  banner: { js: banner }
})
