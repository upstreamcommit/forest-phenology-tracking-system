import { expect, test, type Locator, type Page } from '@playwright/test'

import { YEARS } from '../src/test/fixtures'
import { mockApi } from './mockApi'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

function chart(page: Page) {
  return page.getByRole('figure', { name: /Season timing/ })
}

function yearBar(page: Page, year: number) {
  return chart(page).getByRole('button', { name: new RegExp(`^${year}:`) })
}

interface Point {
  x: number
  y: number
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox()
  if (!b) throw new Error('not shown')
  return { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height }
}

async function centre(locator: Locator): Promise<Point> {
  const { left, right, top, bottom } = await box(locator)
  return { x: (left + right) / 2, y: (top + bottom) / 2 }
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/** Expects `tooltip` to cover no year's hit area but `year`'s own. */
async function expectClearOfOtherYears(page: Page, tooltip: Box, year: number) {
  for (const other of YEARS) {
    if (other === year) continue
    expect(overlaps(tooltip, await box(yearBar(page, other))), `covers ${other}`).toBe(false)
  }
}

/**
 * Scrolls the controls column (the chart's scroll container) so the top of the plot, where the
 * hit areas start, is `offset` pixels below the column's top edge, or above it when negative.
 * Returns the part of the column in view.
 */
async function scrollPlotTop(page: Page, offset: number): Promise<Box> {
  const column = await yearBar(page, 2016).evaluate((bar, offset) => {
    let scroller = bar.parentElement!
    while (getComputedStyle(scroller).overflowY !== 'auto') scroller = scroller.parentElement!
    const top = () => scroller.getBoundingClientRect().top + scroller.clientTop
    scroller.scrollTop += bar.getBoundingClientRect().top - top() - offset
    const { left, right } = scroller.getBoundingClientRect()
    return { left, right, top: top(), bottom: top() + scroller.clientHeight }
  }, offset)
  // The column can scroll that far.
  expect((await box(yearBar(page, 2016))).top).toBeCloseTo(column.top + offset, 0)
  return column
}

/** The tooltip's text for a year: it starts with the year. */
function startsWithYear(year: number) {
  return new RegExp(`^${year}(?!\\d)`)
}

/** Moves the mouse in a straight line, about a pixel per step, as a hand does. */
async function movePixelByPixel(page: Page, from: Point, to: Point) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)))
  await page.mouse.move(to.x, to.y, { steps })
}

/** Opens the point panel, waits for the chart and the year's season, and scrolls to the chart. */
async function openPoint(page: Page) {
  await page.goto('/?lat=51.5&lon=-0.5')
  await expect(page.getByText('2026 season')).toBeVisible()
  await expect(yearBar(page, 2026)).toBeVisible()
  await chart(page).scrollIntoViewIfNeeded()
}

/**
 * Clicks or taps each year in turn where its bar is drawn, and expects each to be selected. A
 * clicked year keeps focus, so its tooltip stays up while the next year is clicked.
 */
async function selectYearsInTurn(page: Page, press: (x: number, y: number) => Promise<void>) {
  // Neighbours on the left half, where a tooltip beside the bar lay to its right, and the right.
  for (const year of [2020, 2021, 2023, 2022]) {
    const { x, y } = await centre(yearBar(page, year))
    await press(x, y)
    await expect(yearBar(page, year)).toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('slider', { name: 'Year' })).toHaveAttribute(
      'aria-valuetext',
      String(year),
    )
    await expect(page.getByText(`${year} season`)).toBeVisible()
  }
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('a click on the year next to the one just clicked selects it', async ({ page }) => {
    await openPoint(page)
    await selectYearsInTurn(page, (x, y) => page.mouse.click(x, y))
  })

  test('the pointer can move from a bar onto its tooltip, a pixel at a time', async ({ page }) => {
    await openPoint(page)
    const tooltip = chart(page).getByRole('tooltip')
    const caption = await box(chart(page).locator('figcaption'))

    for (const year of [2016, 2021, 2026]) {
      const bar = await centre(yearBar(page, year))
      await page.mouse.move(bar.x, bar.y)
      await expect(tooltip).toHaveText(startsWithYear(year))
      // Above the plot, in the room kept for it: under the caption, clear of every other year.
      const shown = await box(tooltip)
      expect(shown.bottom).toBeCloseTo((await box(yearBar(page, year))).top, 1)
      expect(overlaps(shown, caption)).toBe(false)
      await expectClearOfOtherYears(page, shown, year)

      // Straight up to the tooltip's middle, then across to its centre.
      const tip = await centre(tooltip)
      await movePixelByPixel(page, bar, { x: bar.x, y: tip.y })
      await movePixelByPixel(page, { x: bar.x, y: tip.y }, tip)
      await expect(tooltip).toHaveText(startsWithYear(year))
      expect(await centre(tooltip)).toEqual(tip)
    }

    // Leaving the tooltip for somewhere outside the chart dismisses it.
    await page.mouse.move(10, 10)
    await expect(tooltip).toHaveCount(0)
  })

  test('the tooltip shows below the plot when the column hides the room above', async ({
    page,
  }) => {
    await openPoint(page)
    // The table makes the column long enough to scroll the chart to its top.
    await chart(page).getByRole('button', { name: 'Show data table' }).click()
    const tooltip = chart(page).getByRole('tooltip')
    // The row under the plot: the legend and the table button.
    const below = chart(page).getByRole('button', { name: 'Hide data table' }).locator('..')

    // The band above partly hidden, wholly hidden, and the plot's own top hidden too.
    for (const offset of [5, -20, -60]) {
      const column = await scrollPlotTop(page, offset)
      const hit = await box(yearBar(page, 2020))
      // The middle of the part of the year's hit area in view.
      const bar = {
        x: (hit.left + hit.right) / 2,
        y: (Math.max(hit.top, column.top) + hit.bottom) / 2,
      }
      await page.mouse.move(bar.x, bar.y)
      await expect(tooltip).toHaveText(startsWithYear(2020))

      await expect(tooltip).toBeInViewport({ ratio: 0.99 })
      // Inside the column's visible part, to half a pixel.
      const shown = await box(tooltip)
      expect(shown.top).toBeGreaterThan(column.top - 0.5)
      expect(shown.bottom).toBeLessThan(column.bottom + 0.5)
      expect(shown.left).toBeGreaterThan(column.left - 0.5)
      expect(shown.right).toBeLessThan(column.right + 0.5)
      expect(shown.top).toBeCloseTo(hit.bottom, 1)
      await expectClearOfOtherYears(page, shown, 2020)
      expect(overlaps(shown, await box(below))).toBe(false)

      // Straight down onto it, a pixel at a time, keeps it.
      const tip = await centre(tooltip)
      await movePixelByPixel(page, bar, { x: bar.x, y: tip.y })
      await movePixelByPixel(page, { x: bar.x, y: tip.y }, tip)
      await expect(tooltip).toHaveText(startsWithYear(2020))
      await page.mouse.move(10, 10)
      await expect(tooltip).toHaveCount(0)
    }
  })

  test('an open tooltip moves below the plot as the column scrolls the room above away', async ({
    page,
  }) => {
    await openPoint(page)
    await chart(page).getByRole('button', { name: 'Show data table' }).click()
    const tooltip = chart(page).getByRole('tooltip')

    await scrollPlotTop(page, 100)
    const hit = await box(yearBar(page, 2021))
    // Near the top of the hit area, so the pointer is still on it after the scroll below.
    await page.mouse.move((hit.left + hit.right) / 2, hit.top + 10)
    await expect(tooltip).toHaveText(startsWithYear(2021))
    expect((await box(tooltip)).bottom).toBeCloseTo(hit.top, 1)

    // Scroll events reach the page a frame after the scroll, so positions are polled.
    const column = await scrollPlotTop(page, -20)
    await expect(tooltip).toHaveText(startsWithYear(2021))
    await expect
      .poll(async () => (await box(tooltip)).top - (await box(yearBar(page, 2021))).bottom)
      .toBeCloseTo(0, 1)
    await expect(tooltip).toBeInViewport({ ratio: 0.99 })
    expect((await box(tooltip)).bottom).toBeLessThan(column.bottom + 0.5)

    // And back above when the room above scrolls into view again.
    await scrollPlotTop(page, 100)
    await expect(tooltip).toHaveText(startsWithYear(2021))
    await expect
      .poll(async () => (await box(tooltip)).bottom - (await box(yearBar(page, 2021))).top)
      .toBeCloseTo(0, 1)
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('a tap on the year next to the one just tapped selects it', async ({ page }) => {
    await openPoint(page)
    await selectYearsInTurn(page, (x, y) => page.touchscreen.tap(x, y))
  })
})
