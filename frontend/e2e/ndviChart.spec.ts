import { expect, test, type Locator, type Page } from '@playwright/test'

import type { NdviCurve } from '../src/api/types'
import { ndviCurveFor } from '../src/test/fixtures'
import { mockApi } from './mockApi'

// The fixture point (51.5, -0.5) in 2021: 23 composites, threshold 0.45, a computed season from
// 7 Apr to 16 Oct, stored 11 Apr to 20 Oct.
const POINT = '/point/51.5/-0.5?year=2021'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

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

function chart(page: Page) {
  return page.getByRole('figure', { name: /^NDVI through \d{4} / })
}

/** A composite's target, by its date as its name starts: "7 Apr". */
function composite(page: Page, day: string) {
  return chart(page).getByRole('img', { name: new RegExp(`^${day}:`) })
}

function dot(page: Page, doy: number) {
  return chart(page).locator(`circle[data-doy="${doy}"]`)
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

/** Expects `tooltip` to cover no composite's target but `day`'s own. */
async function expectClearOfOtherComposites(page: Page, tooltip: Box, day: string) {
  const targets = await chart(page)
    .getByRole('img', { name: /: NDVI / })
    .evaluateAll((elements) =>
      elements.map((element) => {
        const { left, right, top, bottom } = element.getBoundingClientRect()
        return { name: element.getAttribute('aria-label') ?? '', left, right, top, bottom }
      }),
    )
  expect(targets).toHaveLength(23)
  for (const target of targets) {
    if (target.name.startsWith(`${day}:`)) continue
    expect(overlaps(tooltip, target), `covers ${target.name}`).toBe(false)
  }
}

/** Moves the mouse in a straight line, about a pixel per step, as a hand does. */
async function movePixelByPixel(page: Page, from: Point, to: Point) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)))
  await page.mouse.move(to.x, to.y, { steps })
}

async function openChart(page: Page, url = POINT) {
  await page.goto(url)
  await expect(composite(page, '19 Dec')).toBeVisible()
  await chart(page).scrollIntoViewIfNeeded()
}

/** Answers curve requests at the threshold they ask for (mockApi keeps 50%), or with `curve`. */
async function serveCurves(page: Page, curve?: NdviCurve) {
  await page.route(/\/phenology\/point\/ndvi\?/, (route) => {
    const query = new URL(route.request().url()).searchParams
    const n = (name: string) => Number(query.get(name))
    const body = curve ?? ndviCurveFor(n('lat'), n('lon'), n('year'), n('threshold_frac') || 0.5)
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
}

/**
 * Scrolls the page's scroll container so the top of the plot, where the targets start, is
 * `offset` pixels below the container's top edge. Returns the part of the container in view.
 */
async function scrollPlotTop(page: Page, offset: number): Promise<Box> {
  const view = await composite(page, '1 Jan').evaluate((target, offset) => {
    let scroller = target.parentElement!
    while (getComputedStyle(scroller).overflowY !== 'auto') scroller = scroller.parentElement!
    const top = () => scroller.getBoundingClientRect().top + scroller.clientTop
    scroller.scrollTop += target.getBoundingClientRect().top - top() - offset
    const { left, right } = scroller.getBoundingClientRect()
    return { left, right, top: top(), bottom: top() + scroller.clientHeight }
  }, offset)
  expect((await box(composite(page, '1 Jan'))).top).toBeCloseTo(view.top + offset, 0)
  return view
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('the pointer can move from a dot onto its tooltip, a pixel at a time', async ({ page }) => {
    await openChart(page)
    const tooltip = chart(page).getByRole('tooltip')
    const caption = await box(chart(page).locator('figcaption'))

    for (const [day, doy] of [
      ['1 Jan', 1],
      ['7 Apr', 97],
      ['12 Jul', 193],
      ['16 Oct', 289],
      ['19 Dec', 353],
    ] as const) {
      const start = await centre(dot(page, doy))
      await page.mouse.move(start.x, start.y)
      await expect(tooltip).toHaveText(new RegExp(`^${day} 2021 · day ${doy} · NDVI`))
      // Above the plot, in the room kept for it: under the caption, clear of every other composite.
      const shown = await box(tooltip)
      expect(shown.bottom).toBeCloseTo((await box(composite(page, day))).top, 1)
      expect(overlaps(shown, caption)).toBe(false)
      await expectClearOfOtherComposites(page, shown, day)

      // Straight up to the tooltip's middle, then across to its centre.
      const tip = await centre(tooltip)
      await movePixelByPixel(page, start, { x: start.x, y: tip.y })
      await movePixelByPixel(page, { x: start.x, y: tip.y }, tip)
      await expect(tooltip).toHaveText(new RegExp(`^${day} 2021 `))
      expect(await centre(tooltip)).toEqual(tip)
    }

    // Leaving the tooltip for somewhere outside the chart dismisses it.
    await page.mouse.move(10, 10)
    await expect(tooltip).toHaveCount(0)
  })

  test('the next composite answers a hover or a click while a tooltip is open', async ({
    page,
  }) => {
    await openChart(page)
    const tooltip = chart(page).getByRole('tooltip')
    const pairs = [
      ['7 Apr', 97, '23 Apr', 113],
      ['12 Jul', 193, '28 Jul', 209],
      ['16 Oct', 289, '1 Nov', 305],
    ] as const

    for (const [day, doy, nextDay, nextDoy] of pairs) {
      const here = await centre(dot(page, doy))
      const next = await centre(dot(page, nextDoy))
      await page.mouse.move(here.x, here.y)
      await expect(tooltip).toHaveText(new RegExp(`^${day} 2021`))
      await movePixelByPixel(page, here, next)
      await expect(tooltip).toHaveText(new RegExp(`^${nextDay} 2021`))
    }

    for (const [day, doy, nextDay, nextDoy] of pairs) {
      await dot(page, doy).click({ force: true })
      await expect(composite(page, day)).toBeFocused()
      await expect(tooltip).toHaveText(new RegExp(`^${day} 2021`))
      await dot(page, nextDoy).click({ force: true })
      await expect(composite(page, nextDay)).toBeFocused()
      // Focus keeps it shown once the pointer leaves the chart.
      await page.mouse.move(10, 10)
      await expect(tooltip).toHaveText(new RegExp(`^${nextDay} 2021`))
    }
  })

  test('the tooltip shows below the plot when the page hides the room above', async ({
    page,
  }) => {
    await openChart(page)
    // The table makes the page long enough to scroll the chart to its top.
    await chart(page).getByRole('button', { name: 'Show data table' }).click()
    const tooltip = chart(page).getByRole('tooltip')
    // The row under the plot: the legend and the table button.
    const below = chart(page).getByRole('button', { name: 'Hide data table' }).locator('..')

    // The band above partly hidden, wholly hidden, and the plot's own top hidden too.
    for (const offset of [10, -30, -60]) {
      const view = await scrollPlotTop(page, offset)
      // At the dot's x, halfway down the part of its target in view.
      const hit = await box(composite(page, '12 Jul'))
      const start = {
        x: (await centre(dot(page, 193))).x,
        y: (Math.max(hit.top, view.top) + hit.bottom) / 2,
      }
      await page.mouse.move(start.x, start.y)
      await expect(tooltip).toHaveText(/^12 Jul 2021/)
      await expect(tooltip).toBeInViewport({ ratio: 0.99 })

      const shown = await box(tooltip)
      expect(shown.top).toBeGreaterThan(view.top - 0.5)
      expect(shown.bottom).toBeLessThan(view.bottom + 0.5)
      expect(shown.top).toBeCloseTo((await box(composite(page, '12 Jul'))).bottom, 1)
      await expectClearOfOtherComposites(page, shown, '12 Jul')
      expect(overlaps(shown, await box(below))).toBe(false)

      // Straight down onto it, a pixel at a time, keeps it.
      const tip = await centre(tooltip)
      await movePixelByPixel(page, start, { x: start.x, y: tip.y })
      await movePixelByPixel(page, { x: start.x, y: tip.y }, tip)
      await expect(tooltip).toHaveText(/^12 Jul 2021/)
      await page.mouse.move(10, 10)
      await expect(tooltip).toHaveCount(0)
    }
  })

  test('Escape closes a tooltip opened by the pointer', async ({ page }) => {
    await openChart(page)
    const tooltip = chart(page).getByRole('tooltip')
    const start = await centre(dot(page, 193))
    await page.mouse.move(start.x, start.y)
    await expect(tooltip).toHaveText(/^12 Jul 2021/)
    await page.keyboard.press('Escape')
    await expect(tooltip).toHaveCount(0)
  })
})

/** The tooltip's band: the room kept above and below the plot. */
const BAND = 44

for (const [width, height] of [
  [390, 844],
  [320, 640],
]) {
  test.describe(`${width}px wide`, () => {
    test.use({ viewport: { width, height } })

    // At 95% the curve leaves little room beside the line: the label may shorten to the value,
    // or cross a dashed stored marker, but never covers a dot, the line or a computed marker.
    for (const [threshold, texts, storedCrossings] of [
      ['', ['Threshold 0.45'], 0],
      ['0.95', ['Threshold 0.70', '0.70'], 1],
    ] as const) {
      const at = threshold || 'the default'
      test(`nothing is drawn over the threshold label at ${at} threshold`, async ({ page }) => {
        await serveCurves(page)
        await openChart(page, threshold ? `${POINT}&threshold=${threshold}` : POINT)
        const label = chart(page).locator('text[data-threshold-label]')
        expect(texts).toContain(await label.textContent())

        const { covered, stored, inside } = await label.evaluate((text) => {
          const svg = text.closest('svg')!
          const own = text.getBoundingClientRect()
          const covers = (r: DOMRect, by = 0) =>
            r.left - by < own.right &&
            own.left < r.right + by &&
            r.top - by < own.bottom &&
            own.top < r.bottom + by
          const covered: string[] = []
          const stored: string[] = []
          for (const marker of svg.querySelectorAll('line[data-marker]')) {
            if (!covers(marker.getBoundingClientRect())) continue
            const name = marker.getAttribute('data-marker')!
            if (name.startsWith('stored')) stored.push(name)
            else covered.push(name)
          }
          // Each dot as large as when it is active (r 5, drawn r 3).
          for (const dot of svg.querySelectorAll('circle[data-doy]')) {
            const doy = dot.getAttribute('data-doy')
            if (covers(dot.getBoundingClientRect(), 2)) covered.push(`dot ${doy}`)
          }
          // Points every pixel along the line, in the page's pixels.
          for (const path of svg.querySelectorAll<SVGPathElement>('path[data-line]')) {
            const ctm = path.getScreenCTM()!
            for (let at = 0; at <= path.getTotalLength(); at += 1) {
              const { x, y } = path.getPointAtLength(at).matrixTransform(ctm)
              if (x >= own.left && x <= own.right && y >= own.top && y <= own.bottom) {
                covered.push(`line at ${x}, ${y}`)
                break
              }
            }
          }
          // Painted last, so even the halo of a near miss sits on top.
          if (svg.lastElementChild !== text) covered.push('painted before other marks')
          const chart = svg.getBoundingClientRect()
          return { covered, stored, inside: own.left >= chart.left && own.right <= chart.right }
        })
        expect(covered).toEqual([])
        expect(stored.length).toBeLessThanOrEqual(storedCrossings)
        expect(inside).toBe(true)
      })
    }

    // The longest second lines: a season of one composite (26 Jun) just above the threshold,
    // and a season start above a threshold it takes three decimals to tell it from.
    const oneComposite: NdviCurve = {
      ...ndviCurveFor(51.5, -0.5, 2021),
      threshold_ndvi: 0.72993,
      sos_date: '2021-06-26',
      eos_date: '2021-06-26',
      season_length: 0,
    }
    for (const [name, url, curve, edgeDay, edgeName] of [
      [
        'a season of one composite',
        POINT,
        oneComposite,
        '26 Jun',
        '26 Jun: NDVI 0.730, just above the threshold, start and end of season',
      ],
      [
        'a threshold with three decimals',
        '/point/51/-1?year=2016&threshold=0.95',
        undefined,
        '22 Apr',
        '22 Apr: NDVI 0.704, above the threshold of 0.702, start of season',
      ],
    ] as const) {
      test(`every tooltip stays two lines high, in its band, for ${name}`, async ({ page }) => {
        await serveCurves(page, curve)
        await page.goto(url)
        await expect(composite(page, edgeDay)).toHaveAccessibleName(edgeName)
        await chart(page).scrollIntoViewIfNeeded()
        const tooltip = chart(page).getByRole('tooltip')

        const targets = chart(page).getByRole('img', { name: /: NDVI / })
        for (let i = 0; i < (await targets.count()); i++) {
          const target = targets.nth(i)
          await target.focus()
          const label = (await target.getAttribute('aria-label'))!
          await expect(tooltip).toHaveText(new RegExp(`^${label.split(':')[0]} `))
          const lines = await tooltip.locator('p').evaluateAll((ps) =>
            ps.map((p) => p.getBoundingClientRect().height),
          )
          // A line of 12px text is 16px high.
          for (const lineHeight of lines) expect(lineHeight, label).toBeLessThan(16.5)
          const shown = await box(tooltip)
          const own = await box(target)
          expect(shown.bottom - shown.top, label).toBeLessThanOrEqual(BAND)
          if (shown.bottom <= own.top + 0.5) {
            expect(shown.top, label).toBeGreaterThan(own.top - BAND - 0.5)
          } else {
            expect(shown.bottom, label).toBeLessThan(own.bottom + BAND + 0.5)
          }
          // The season edge is the part of the second line that always shows.
          if (label.includes('of season')) {
            const edge = await box(tooltip.locator('p').nth(1).locator('span').first())
            expect(edge.right, label).toBeLessThanOrEqual(shown.right)
            expect(edge.bottom, label).toBeLessThanOrEqual(shown.bottom)
          }
        }
      })
    }
  })
}
