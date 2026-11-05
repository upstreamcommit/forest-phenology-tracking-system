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

test.describe('desktop layout', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('keeps the header in place and the map filling the height under it', async ({ page }) => {
    await page.goto('/?lat=51.5&lon=-0.5')
    await expect(page.getByText('2026 season')).toBeVisible()

    await scrollEverythingDown(page)

    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    const header = await page.locator('header').first().boundingBox()
    const map = await page.locator('.maplibregl-map').boundingBox()
    expect(header?.y).toBe(0)
    expect(map && header && Math.round(map.y - (header.y + header.height))).toBeLessThanOrEqual(1)
    expect(map && Math.round(map.y + map.height)).toBe(800)
    // The controls sit to the left of the map.
    const heading = await page.getByRole('heading', { level: 1, name: 'Phenology map' }).boundingBox()
    expect(heading && map && heading.x).toBeLessThan(map?.x ?? 0)
  })
})

test.describe('phone layout', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('puts the map before the controls in the Tab order, as on screen', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Season length' })).toBeVisible()

    const map = await page.locator('canvas.maplibregl-canvas').boundingBox()
    const controls = await page.getByRole('radio', { name: 'Season length' }).boundingBox()
    expect(map && controls && map.y).toBeLessThan(controls?.y ?? 0)

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
    expect(order).toContain('map')
    expect(order.indexOf('map')).toBeLessThan(order.indexOf('controls'))
  })
})
