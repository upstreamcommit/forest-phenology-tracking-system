import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// API paths the dev server forwards to the backend. The app calls them same-origin, as it does
// behind nginx in docker compose, so the API needs no CORS.
const API_PATHS = ['/catalog', '/phenology', '/health', '/docs', '/openapi.json']

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.FPTS_API_URL || 'http://localhost:8000'
  const proxy = Object.fromEntries(API_PATHS.map((path) => [path, { target, changeOrigin: true }]))

  return {
    plugins: [react(), tailwindcss()],
    // The lazily loaded map page is mostly MapLibre (about 1.1 MB, 300 kB gzipped).
    build: { chunkSizeWarningLimit: 1200 },
    server: { proxy },
    preview: { proxy },
  }
})
