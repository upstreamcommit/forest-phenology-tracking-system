import { defineConfig, devices } from '@playwright/test'

// Not 4173, vite preview's default, so a running `npm run preview` is never mistaken for the
// test build. E2E_PORT overrides it.
const PORT = Number(process.env.E2E_PORT ?? 4174)
// Its own output directory, so the test build (no basemap) never replaces the real one in dist/.
const OUT_DIR = 'dist-e2e'

// End-to-end tests run a production build with a blank basemap and the API mocked by
// e2e/mockApi.ts (from the fixtures in src/test/fixtures.ts), so they need no backend and no
// network.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // West of Greenwich, where a calendar date read as local time shows as the day before.
    timezoneId: 'America/Los_Angeles',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      `VITE_BASEMAP=none npx vite build --outDir ${OUT_DIR} && ` +
      `npx vite preview --outDir ${OUT_DIR} --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
