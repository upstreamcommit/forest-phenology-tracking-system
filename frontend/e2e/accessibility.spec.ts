import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { mockApi } from './mockApi'

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // MapLibre's canvas and attribution are third-party widgets outside the app's control.
    .exclude('.maplibregl-canvas-container')
    .exclude('.maplibregl-ctrl-attrib')
    .analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(
    serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`),
  ).toEqual([])
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await mockApi(page)
      await page.addInitScript((t) => localStorage.setItem('fpts-theme', t), theme)
    })

    test('map explorer with a selected point has no serious accessibility violations', async ({
      page,
    }) => {
      await page.goto('/?lat=51.5&lon=-0.5')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.getByText('2026 season')).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expectNoSeriousViolations(page)
    })

    test('data and methods page has no serious accessibility violations', async ({ page }) => {
      await page.goto('/about')
      await expect(page.getByText(/0\.01° pixels/)).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page).toHaveTitle('Data & methods · Forest Phenology Explorer')
      await expectNoSeriousViolations(page)
    })
  })
}
