import { expect, test } from '@playwright/test'

import { mockApi } from './mockApi'

// vite preview sends the production headers from security-headers.conf, so a script, style or
// worker the Content-Security-Policy blocks shows up here as a violation.
const PAGES = ['/', '/?lat=51.5&lon=-0.5', '/point/51.5/-0.5?year=2021', '/about']

for (const path of PAGES) {
  test(`${path} runs under the Content-Security-Policy without violations`, async ({ page }) => {
    await mockApi(page)
    await page.addInitScript(() => {
      const seen: string[] = []
      Object.assign(window, { cspViolations: seen })
      document.addEventListener('securitypolicyviolation', (event) => {
        seen.push(`${event.violatedDirective} ${event.blockedURI}`)
      })
    })
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) {
        consoleErrors.push(message.text())
      }
    })

    const response = await page.goto(path)
    expect(response?.headers()['content-security-policy']).toContain("script-src 'self'")
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // Let lazy chunks, the map worker and the charts load.
    await page.waitForLoadState('networkidle')

    const violations = await page.evaluate(
      () => (window as unknown as { cspViolations: string[] }).cspViolations,
    )
    expect(violations).toEqual([])
    expect(consoleErrors).toEqual([])
  })
}
