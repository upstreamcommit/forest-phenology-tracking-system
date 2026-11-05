import { expect, test, type Page } from '@playwright/test'

import { catalog } from '../src/test/fixtures'
import { mockApi } from './mockApi'

const PHONE = { width: 390, height: 844 }

/** Mercator x and y of a longitude and latitude, as fractions of the world. */
function mercator(lon: number, lat: number): [number, number] {
  const phi = (lat * Math.PI) / 180
  return [(lon + 180) / 360, (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2]
}

/**
 * Where a point is drawn on the screen before the map has moved: the map starts fitted to the
 * stored bbox with 24px of padding, as PhenologyMap sets it up.
 */
async function screenPoint(page: Page, lat: number, lon: number) {
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
  if (!box) throw new Error('the map canvas is not shown')
  const [west, south, east, north] = catalog.products[0].stored!.bbox
  const [x0, y0] = mercator(west, north)
  const [x1, y1] = mercator(east, south)
  const scale = Math.min((box.width - 48) / (x1 - x0), (box.height - 48) / (y1 - y0))
  const [x, y] = mercator(lon, lat)
  return {
    x: box.x + box.width / 2 + (x - (x0 + x1) / 2) * scale,
    y: box.y + box.height / 2 + (y - (y0 + y1) / 2) * scale,
  }
}

/** Presses Tab until `target` has focus, so the browser shows keyboard focus. */
async function tabTo(page: Page, selector: string) {
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab')
    if (await page.evaluate((s) => document.activeElement?.matches(s), selector)) return
  }
  throw new Error(`Tab never reached ${selector}`)
}

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test('loads the map explorer with the latest year and the synthetic-data warning', async ({
  page,
}) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1, name: 'Phenology map' })).toBeVisible()
  await expect(page.getByText(/synthetic/).first()).toBeVisible()
  await expect(page.getByText('API online')).toBeVisible()
  // The slider steps through year indexes and announces the year itself.
  await expect(page.getByRole('slider', { name: 'Year' })).toHaveAttribute('aria-valuetext', '2026')
  await expect(page.getByRole('radio', { name: 'Season length' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  // MapLibre drew its canvas (WebGL works in the test browser).
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible()
})

test('finds a point by coordinates, shows its season and keeps it in the URL', async ({
  page,
}) => {
  await page.goto('/')

  const search = page.getByRole('search', { name: 'Find a point' })
  await search.getByLabel('Latitude').fill('51.52')
  await search.getByLabel('Longitude').fill('-0.47')
  await search.getByRole('button', { name: 'Find cell' }).click()

  const panel = page.getByRole('region', { name: /Selected point/ })
  await expect(panel.getByRole('heading', { name: '51.50° N, 0.50° W' })).toBeVisible()
  await expect(panel.getByText('2026 season')).toBeVisible()
  await expect(page).toHaveURL(/lat=51\.5&lon=-0\.5/)

  // The selection survives a reload, since it lives in the URL.
  await page.reload()
  await expect(
    page.getByRole('region', { name: /Selected point/ }).getByRole('heading', {
      name: '51.50° N, 0.50° W',
    }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Close point details' }).click()
  await expect(page.getByRole('region', { name: /Selected point/ })).toHaveCount(0)
  await expect(page).not.toHaveURL(/lat=/)
})

test('changes metric and year with the keyboard', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('radio', { name: 'Season length' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: 'Start of season' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(page).toHaveURL(/metric=sos/)

  const slider = page.getByRole('slider', { name: 'Year' })
  await slider.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(slider).toHaveAttribute('aria-valuetext', '2025')
  await expect(page).toHaveURL(/year=2025/)
})

test('takes every step of quick key presses on the year slider', async ({ page }) => {
  await page.goto('/')
  const slider = page.getByRole('slider', { name: 'Year' })
  await expect(slider).toHaveAttribute('aria-valuetext', '2026')

  // The second press comes before the URL has caught up with the first.
  await slider.focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')

  await expect(slider).toHaveAttribute('aria-valuetext', '2024')
  await expect(page).toHaveURL(/year=2024/)
  await expect(page.getByRole('region', { name: 'Map of season length in 2024' })).toHaveCount(1)
})

test('keeps focus on the Next year button when it reaches the last year', async ({ page }) => {
  await page.goto('/?year=2025')
  const next = page.getByRole('button', { name: 'Next year' })
  await next.click()

  await expect(page.getByRole('slider', { name: 'Year' })).toHaveAttribute('aria-valuetext', '2026')
  await expect(next).toHaveAttribute('aria-disabled', 'true')
  await expect(next).toBeFocused()
})

test('shows a focus ring on the map when it is reached with the keyboard', async ({ page }) => {
  await page.goto('/')
  const map = page.locator('.maplibregl-map')
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible()
  const ring = () => map.evaluate((el) => getComputedStyle(el, '::after').boxShadow)
  expect(await ring()).toBe('none')

  await tabTo(page, 'canvas.maplibregl-canvas')

  const focusColour = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--focus').trim(),
  )
  expect(focusColour).toBe('#1f6feb')
  // An inset ring of the focus colour (rgb of #1f6feb) inside the map's clipped edge.
  expect(await ring()).toMatch(/rgb\(31, 111, 235\) 0px 0px 0px 3px inset/)
})

test('draws the map controls in dark theme colours', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('fpts-theme', 'dark'))
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  const controls = page.locator('.maplibregl-ctrl-group')
  await expect(controls).toBeVisible()
  // --surface of the dark theme, #161e19, instead of MapLibre's white.
  await expect(controls).toHaveCSS('background-color', 'rgb(22, 30, 25)')
  await expect(controls.locator('.maplibregl-ctrl-icon').first()).toHaveCSS('filter', 'invert(1)')
})

test.describe('on a phone', () => {
  test.use({ viewport: PHONE })

  test('brings the point panel into view after a search', async ({ page }) => {
    await page.goto('/')
    const search = page.getByRole('search', { name: 'Find a point' })
    await expect(search.getByRole('button', { name: 'Find cell' })).toBeEnabled()
    await search.getByLabel('Latitude').fill('51.5')
    await search.getByLabel('Longitude').fill('0.5 W')
    // The form at the bottom of the screen, as after scrolling down to it: the panel opens below.
    await search.evaluate((el) => el.scrollIntoView({ block: 'end' }))
    await search.getByLabel('Longitude').press('Enter')

    const panel = page.getByRole('region', { name: /Selected point/ })
    await expect(panel.getByRole('heading', { name: '51.50° N, 0.50° W' })).toBeInViewport()
    await expect(page).toHaveURL(/lat=51\.5&lon=-0\.5/)
  })

  test('brings the point panel into view and focuses it after a tap on the map', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('region', { name: 'Map of season length in 2026' })).toHaveCount(1)
    // The fixture grid covers 51-52° N, 1° W-0°, a block about 25px across on this screen. The
    // cells appear once MapLibre has drawn them, so tap until one is selected.
    const point = await screenPoint(page, 51.5, -0.5)
    await expect(async () => {
      await page.mouse.click(point.x, point.y)
      await expect(page).toHaveURL(/lat=5[12](\.\d+)?&lon=-?[01](\.\d+)?$/, { timeout: 500 })
    }).toPass()

    const panel = page.getByRole('region', { name: /Selected point/ })
    await expect(panel.getByRole('heading', { level: 2 })).toBeInViewport()
    expect(
      await page.evaluate(() => document.activeElement?.textContent?.includes('Selected point')),
    ).toBe(true)
  })
})

test('navigates to data and methods and back, and shows a 404 for unknown pages', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Data & methods' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Data & methods' })).toBeVisible()
  await expect(page.getByText(/0\.01° pixels/)).toBeVisible()

  await page.goto('/no/such/page')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to the map' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Phenology map' })).toBeVisible()
})

test('says so when the API is down', async ({ page }) => {
  await mockApi(page, { apiDown: true })
  await page.goto('/')

  await expect(page.getByText('API unreachable')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(/could not be reached/i)
})
