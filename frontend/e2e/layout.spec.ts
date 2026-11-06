import { expect, test, type Page } from '@playwright/test'

import { mockApi } from './mockApi'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

/** The document's scrollable height, and the height of what the app draws. */
function heights(page: Page) {
  return page.evaluate(() => ({
    document: document.documentElement.scrollHeight,
    content: Math.ceil(document.getElementById('root')!.getBoundingClientRect().height),
    viewport: window.innerHeight,
  }))
}

/** Scrolls the window, and every scrolling box in the page, as far down as they go. */
function scrollEverythingDown(page: Page) {
  return page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>('body *')) {
      if (element.scrollHeight > element.clientHeight) element.scrollTop = element.scrollHeight
    }
    window.scrollTo(0, document.documentElement.scrollHeight)
  })
}

const SIZES = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'small desktop', width: 1024, height: 768 },
  { name: 'phone', width: 390, height: 844 },
  // 1280x1024 zoomed to 400%.
  { name: 'zoomed', width: 320, height: 256 },
]

for (const size of SIZES) {
  test.describe(`${size.name} (${size.width}x${size.height})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test('the document is as tall as the page, with no blank space to scroll into', async ({
      page,
    }) => {
      await page.goto('/?lat=51.5&lon=-0.5')
      await expect(page.getByText('2026 season')).toBeAttached()
      await expect(page.getByRole('figure', { name: /Season timing/ })).toBeAttached()

      const { document, content, viewport } = await heights(page)
      expect(Math.abs(document - Math.max(content, viewport))).toBeLessThanOrEqual(1)

      // Scrolled to the very end, the page still fills the screen: the header has not gone up
      // over blank space.
      await scrollEverythingDown(page)
      const bottom = await page.locator('#root').evaluate((el) => el.getBoundingClientRect().bottom)
      expect(bottom).toBeGreaterThanOrEqual(viewport - 1)
      expect((await heights(page)).document).toBe(document)
    })
  })
}

/**
 * Presses Tab until the Season length radio (the first control) has focus, noting what each press
 * reached: 'map' for the map canvas, 'controls' for the radio, otherwise the tag name.
 */
async function tabOrder(page: Page) {
  const order: string[] = []
  for (let i = 0; i < 30 && !order.includes('controls'); i++) {
    await page.keyboard.press('Tab')
    order.push(
      await page.evaluate(() => {
        const element = document.activeElement
        if (element?.matches('canvas.maplibregl-canvas')) return 'map'
        if (element?.matches('[role="radio"]') && element.textContent === 'Season length') {
          return 'controls'
        }
        return element?.tagName.toLowerCase() ?? 'none'
      }),
    )
  }
  return order
}

test.describe('desktop layout', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('keeps the header in place and the map filling the height under it', async ({ page }) => {
    await page.goto('/?lat=51.5&lon=-0.5')
    await expect(page.getByText('2026 season')).toBeVisible()

    // The map fills the left; the heading and, under it, the controls share a column to its right.
    const map = await page.locator('.maplibregl-map').boundingBox()
    const heading = await page.getByRole('heading', { level: 1, name: 'Phenology map' }).boundingBox()
    const controls = await page.getByRole('radio', { name: 'Season length' }).boundingBox()
    if (!map || !heading || !controls) throw new Error('the map, heading or controls are not shown')
    expect(map.x).toBe(0)
    expect(heading.x).toBeGreaterThanOrEqual(map.x + map.width)
    expect(controls.x).toBeGreaterThanOrEqual(map.x + map.width)
    expect(heading.y).toBeLessThan(controls.y)

    await scrollEverythingDown(page)

    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    const header = await page.locator('header').first().boundingBox()
    const mapAfter = await page.locator('.maplibregl-map').boundingBox()
    expect(header?.y).toBe(0)
    expect(mapAfter && header && Math.round(mapAfter.y - (header.y + header.height))).toBeLessThanOrEqual(1)
    expect(mapAfter && Math.round(mapAfter.y + mapAfter.height)).toBe(800)
  })

  test('scrolls the controls inside their own column, never the page', async ({ page }) => {
    await page.goto('/?lat=51.5&lon=-0.5')
    await expect(page.getByText('2026 season')).toBeVisible()

    const column = await page.getByRole('search', { name: 'Find a point' }).evaluate((form) => {
      let element = form.parentElement
      while (element && getComputedStyle(element).overflowY !== 'auto') {
        element = element.parentElement
      }
      return element && {
        position: getComputedStyle(element).position,
        scrolls: element.scrollHeight > element.clientHeight,
      }
    })
    // Positioned, so visually hidden text inside it cannot stretch the document.
    expect(column).toEqual({ position: 'relative', scrolls: true })
  })
})

test.describe('small desktop layout', () => {
  test.use({ viewport: { width: 1024, height: 768 } })

  test('leaves the map most of the width beside the controls column', async ({ page }) => {
    await page.goto('/?lat=51.5&lon=-0.5')
    await expect(page.getByText('2026 season')).toBeVisible()

    const map = await page.locator('.maplibregl-map').boundingBox()
    const controls = await page.getByRole('radio', { name: 'Season length' }).boundingBox()
    if (!map || !controls) throw new Error('the map or the controls are not shown')
    expect(map.width).toBeGreaterThanOrEqual(600)
    expect(controls.x).toBeGreaterThanOrEqual(map.x + map.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1024)
  })
})

// WCAG 2.2 target size (minimum): 24px. The chart sits in the 24rem controls column from lg up.
for (const size of [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test.describe(`trend chart at ${size.width}x${size.height}`, () => {
    test.use({ viewport: size })

    test('gives every year a target at least 24px wide', async ({ page }) => {
      await page.goto('/?lat=51.5&lon=-0.5')
      const figure = page.getByRole('figure', { name: /Season timing/ })
      await expect(figure).toBeVisible()

      const widths = await figure
        .locator('button[aria-label]')
        .evaluateAll((buttons) => buttons.map((b) => b.getBoundingClientRect().width))
      expect(widths).toHaveLength(11)
      expect(Math.min(...widths)).toBeGreaterThanOrEqual(24)
    })
  })
}

for (const size of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test.describe(`${size.name} order (${size.width}x${size.height})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test('puts the heading, then the map, then the controls in the document and Tab order', async ({
      page,
    }) => {
      await page.goto('/')
      const heading = page.getByRole('heading', { level: 1, name: 'Phenology map' })
      await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible()
      await expect(page.getByRole('radio', { name: 'Season length' })).toBeVisible()

      const headingFirst = await heading.evaluate((element) => {
        const map = document.querySelector('.maplibregl-map')
        return map !== null && !!(element.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING)
      })
      expect(headingFirst).toBe(true)

      const order = await tabOrder(page)
      expect(order).toContain('map')
      expect(order.indexOf('map')).toBeLessThan(order.indexOf('controls'))

      if (size.name === 'phone') {
        // Stacked in the same order on screen.
        const top = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())?.y
        const headingTop = await top(heading)
        const mapTop = await top(page.locator('.maplibregl-map'))
        const controlsTop = await top(page.getByRole('radio', { name: 'Season length' }))
        expect(headingTop).toBeLessThan(mapTop ?? 0)
        expect(mapTop).toBeLessThan(controlsTop ?? 0)
      }
    })

    test('after navigating back to the map, Tab goes from the heading to the map', async ({
      page,
    }) => {
      await page.goto('/')
      await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible()
      const nav = page.getByRole('navigation', { name: 'Main' })
      await nav.getByRole('link', { name: 'Data & methods' }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'Data & methods' })).toBeVisible()

      await nav.getByRole('link', { name: 'Map', exact: true }).click()

      await expect(page.getByRole('heading', { level: 1, name: 'Phenology map' })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(page.locator('canvas.maplibregl-canvas')).toBeFocused()
    })
  })
}
