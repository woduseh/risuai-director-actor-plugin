import { readFile, mkdir, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { createPluginBanner } from './src/build/banner.js'

const packageJson = JSON.parse(
  await readFile(new URL('./package.json', import.meta.url), 'utf8')
)

const banner = createPluginBanner({
  name: 'risuai-director-actor-plugin',
  displayName: 'RisuAI Director Actor',
  version: packageJson.version,
  description: 'Director-Actor collaborative long-memory plugin for RisuAI Plugin V3'
})

await rm(new URL('./dist', import.meta.url), { recursive: true, force: true })
await mkdir(new URL('./dist', import.meta.url), { recursive: true })

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/risuai-director-actor-plugin.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: false,
  legalComments: 'none',
  banner: { js: banner }
})
