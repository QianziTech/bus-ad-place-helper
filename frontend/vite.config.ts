import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

const target = process.env.API_TARGET || 'http://127.0.0.1:3000'
const offlineMapId = 'virtual:offline-coverage-map'
const resolvedOfflineMapId = `\0${offlineMapId}`

function offlineCoverageMap(): Plugin {
  const mapEntry = fileURLToPath(new URL('./src/plan/coverageMap.ts', import.meta.url))
  const require = createRequire(import.meta.url)
  const echartsDir = dirname(require.resolve('echarts/package.json'))
  const zrenderDir = dirname(createRequire(join(echartsDir, 'package.json')).resolve('zrender/package.json'))
  const notices = [join(echartsDir, 'NOTICE'), join(echartsDir, 'LICENSE'), join(echartsDir, 'licenses/LICENSE-d3'), join(zrenderDir, 'LICENSE')]
    .map(path => readFileSync(path, 'utf8')).join('\n\n')

  return {
    name: 'offline-coverage-map',
    resolveId: source => source === offlineMapId ? resolvedOfflineMapId : undefined,
    async load(source) {
      if (source !== resolvedOfflineMapId) return
      this.addWatchFile(mapEntry)
      for (const resource of ['shanghai-outline.json', 'shanghai-districts.json']) {
        this.addWatchFile(join(dirname(mapEntry), 'maps', resource))
      }
      const { outputFiles } = await build({
        entryPoints: [mapEntry], bundle: true, write: false, format: 'iife', target: 'es2020',
        minify: true, legalComments: 'inline', banner: { js: `/*!\n${notices}\n*/` },
      })
      return `export default ${JSON.stringify(outputFiles[0].text)}`
    },
  }
}

export default defineConfig({
  plugins: [vue(), offlineCoverageMap()],
  server: {
    port: 5173,
    proxy: { '/api': { target, changeOrigin: true } },
  },
  build: {
    outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1600,
    rollupOptions: { output: { manualChunks: id => id === resolvedOfflineMapId ? 'offline-coverage-map' : undefined } },
  },
})
