import { readFileSync } from 'node:fs'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// API paths the dev server forwards to the backend. The app calls them same-origin, as it does
// behind nginx in docker compose, so the API needs no CORS.
const API_PATHS = ['/catalog', '/phenology', '/health', '/docs', '/openapi.json']

// The security headers nginx sends (security-headers.conf), for `vite preview`, so the end-to-end
// and accessibility tests run under the production Content-Security-Policy. Not for the dev
// server, whose React refresh preamble is an inline script.
function securityHeaders(): Record<string, string> {
  const conf = readFileSync(new URL('./security-headers.conf', import.meta.url), 'utf8')
  const lines = conf.split('\n').map((line) => line.trim())
  return Object.fromEntries(
    lines
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => {
        const match = /^add_header ([A-Za-z-]+) "([^"]+)" always;$/.exec(line)
        if (!match) throw new Error(`security-headers.conf: cannot read "${line}"`)
        return [match[1], match[2]]
      }),
  )
}

export default defineConfig(({ mode, isPreview }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.FPTS_API_URL || 'http://localhost:8000'
  const proxy = Object.fromEntries(API_PATHS.map((path) => [path, { target, changeOrigin: true }]))

  return {
    plugins: [react(), tailwindcss()],
    // The lazily loaded map page is mostly MapLibre (about 1.1 MB, 300 kB gzipped).
    build: { chunkSizeWarningLimit: 1200 },
    server: { proxy },
    // Static files and the app's HTML get these; proxied API responses do not, as behind nginx.
    // Read only for preview, so a line the parser rejects cannot break dev or build.
    preview: { proxy, headers: isPreview ? securityHeaders() : undefined },
  }
})
