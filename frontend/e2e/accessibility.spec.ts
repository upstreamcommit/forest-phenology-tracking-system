import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { mockApi } from './mockApi'

/** The trend chart's year targets, one per year across the chart. */
const CHART_YEARS = 'figure button[aria-label]'

/**
 * Runs axe and expects no serious or critical violations. `targetSizeExempt` leaves elements out
 * of the target-size rule only (every other rule still checks them).
 */
async function expectNoSeriousViolations(page: Page, targetSizeExempt?: string) {
  const scan = () =>
    new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      // MapLibre's canvas and attribution are third-party widgets outside the app's control.
      .exclude('.maplibregl-canvas-container')
      .exclude('.maplibregl-ctrl-attrib')
  const scans = targetSizeExempt
    ? [
        scan().disableRules(['target-size']),
        scan().withRules(['target-size']).exclude(targetSizeExempt),
      ]
    : [scan()]
  const violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations'] = []
  // One at a time: axe cannot run twice at once on a page.
  for (const builder of scans) violations.push(...(await builder.analyze()).violations)
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(
    serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`),
  ).toEqual([])
}

const SIZES = [
  { name: 'desktop', viewport: undefined, targetSizeExempt: undefined },
  { name: 'phone', viewport: { width: 390, height: 844 }, targetSizeExempt: undefined },
  // 1280x1024 zoomed to 400%. The chart's year targets are under 24px wide here. WCAG 2.5.8's
  // Equivalent exception covers them: the Year slider and the Previous and Next year buttons
  // pick the same years.
  { name: 'zoomed', viewport: { width: 320, height: 640 }, targetSizeExempt: CHART_YEARS },
]

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await mockApi(page)
      await page.addInitScript((t) => localStorage.setItem('fpts-theme', t), theme)
    })

    for (const { name, viewport, targetSizeExempt } of SIZES) {
      test.describe(name, () => {
        if (viewport) test.use({ viewport })

        test('map explorer with a selected point has no serious accessibility violations', async ({
          page,
        }) => {
          await page.goto('/?lat=51.5&lon=-0.5')
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
          await expect(page.getByText('2026 season')).toBeVisible()
          await expectNoSeriousViolations(page, targetSizeExempt)

          // axe checks the size of targets on the screen only, so bring the trend chart up.
          await page.getByRole('figure', { name: /Season timing/ }).scrollIntoViewIfNeeded()
          await expect(page.locator(CHART_YEARS).first()).toBeInViewport()
          await expectNoSeriousViolations(page, targetSizeExempt)
        })
      })
    }

    test('data and methods page has no serious accessibility violations', async ({ page }) => {
      await page.goto('/about')
      await expect(page.getByText(/0\.01° pixels/)).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page).toHaveTitle('Data & methods · Forest Phenology Explorer')
      await expectNoSeriousViolations(page)
    })
  })
}
