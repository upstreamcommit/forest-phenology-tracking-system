import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Run west of Greenwich, where a date parsed as UTC midnight shows as the previous day, so a
// slip into local-time date handling fails the tests. Set before the test workers start.
process.env.TZ = 'America/Los_Angeles'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
  },
})
