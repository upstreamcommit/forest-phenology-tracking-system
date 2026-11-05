import { expect, test, type Locator, type Page, type Route } from '@playwright/test'

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

/** Whether a request is for the grid of `year`. */
function gridOf(year: number) {
  return (url: URL) =>
    url.pathname === '/phenology/grid' && url.searchParams.get('year') === String(year)
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The scroll position of the column the controls scroll in from lg up. */
function columnScrollTop(page: Page) {
  return page.getByRole('search', { name: 'Find a point' }).evaluate((form) => {
    let element = form.parentElement
    while (element && getComputedStyle(element).overflowY !== 'auto') {
      element = element.parentElement
    }
    return element?.scrollTop ?? null
  })
}

/** Expects `inner` to lie wholly inside `outer` on the screen. */
async function expectInside(inner: Locator, outer: Locator) {
  const [a, b] = await Promise.all([inner.boundingBox(), outer.boundingBox()])
  if (!a || !b) throw new Error('an element is not shown')
  expect(a.x).toBeGreaterThanOrEqual(b.x)
  expect(a.y).toBeGreaterThanOrEqual(b.y)
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + b.width)
  expect(a.y + a.height).toBeLessThanOrEqual(b.y + b.height)
}

/** Expects the top of `lower` to be at or below the bottom of `upper`. */
async function expectBelow(lower: Locator, upper: Locator) {
  const [a, b] = await Promise.all([lower.boundingBox(), upper.boundingBox()])
  if (!a || !b) throw new Error('an element is not shown')
  expect(a.y).toBeGreaterThanOrEqual(b.y + b.height)
}

/**
 * How far the page is short of where scrollIntoView({ block: 'start' }) would now put `locator`:
 * its top 8px (its scroll margin) below the top of the screen, or the end of the page if that
 * comes first.
 */
function revealShortfall(locator: Locator) {
  return locator.evaluate((el) => {
    const top = el.getBoundingClientRect().top + window.scrollY - 8
    const end = document.documentElement.scrollHeight - window.innerHeight
    return Math.round(Math.min(top, end) - window.scrollY)
  })
}

/**
 * The colour of an element's focus glow (its box-shadow) as drawn, after any invert() filter on
 * the element, as [r, g, b].
 */
function drawnGlow(locator: Locator) {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el)
    const [r, g, b] = (style.boxShadow.match(/\d+/g) ?? []).slice(0, 3).map(Number)
    return style.filter === 'invert(1)' ? [255 - r, 255 - g, 255 - b] : [r, g, b]
  })
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

test('keeps the map focus ring in forced-colors mode, which drops box shadows', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await page.goto('/')
  const map = page.locator('.maplibregl-map')
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible()

  await tabTo(page, 'canvas.maplibregl-canvas')

  const ring = await map.evaluate((el) => {
    const style = getComputedStyle(el, '::after')
    return { shadow: style.boxShadow, outline: `${style.outlineStyle} ${style.outlineWidth}` }
  })
  expect(ring).toEqual({ shadow: 'none', outline: 'solid 3px' })
  // A second ring in the opposite system colour shows against a basemap in either theme.
  const inner = await map.evaluate((el) => {
    const style = getComputedStyle(el, '::before')
    return `${style.outlineStyle} ${style.outlineWidth}`
  })
  expect(inner).toBe('solid 2px')
})

test('keeps the zoom icons and a focus outline on the map buttons in forced colours, dark', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' })
  await page.addInitScript(() => localStorage.setItem('fpts-theme', 'dark'))
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const zoomIn = page.locator('.maplibregl-ctrl-zoom-in')
  const icon = zoomIn.locator('.maplibregl-ctrl-icon')
  await expect(icon).toBeVisible()

  // MapLibre draws the icons in the system colours; the dark theme's invert would hide them.
  await expect(icon).toHaveCSS('filter', 'none')
  const withIcon = await zoomIn.screenshot()
  await icon.evaluate((el) => el.style.setProperty('visibility', 'hidden'))
  const withoutIcon = await zoomIn.screenshot()
  await icon.evaluate((el) => el.style.removeProperty('visibility'))
  expect(withIcon.equals(withoutIcon)).toBe(false)

  // Forced colours drop MapLibre's box-shadow focus glow, so the buttons get an outline.
  for (const selector of ['.maplibregl-ctrl-zoom-in', '.maplibregl-ctrl-attrib-button']) {
    await tabTo(page, selector)
    const outline = await page.locator(selector).evaluate((el) => {
      const style = getComputedStyle(el)
      return `${style.outlineStyle} ${style.outlineWidth}`
    })
    expect(outline).toBe('solid 2px')
  }
})

for (const theme of ['light', 'dark'] as const) {
  test(`keeps the attribution button's icon on a dark system palette, app theme ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' })
    await page.addInitScript((t) => localStorage.setItem('fpts-theme', t), theme)
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    const button = page.locator('.maplibregl-ctrl-attrib-button')
    await expect(button).toBeVisible()

    // The icon is the button's background image; without a visible icon both shots match.
    const withIcon = await button.screenshot()
    await button.evaluate((el) => el.style.setProperty('background-image', 'none'))
    const withoutIcon = await button.screenshot()
    expect(withIcon.equals(withoutIcon)).toBe(false)
    // And it is light on the dark system background, not black on black.
    await button.evaluate((el) => el.style.removeProperty('background-image'))
    await expect(button).toHaveCSS('filter', 'invert(1)')
  })
}

test('shows a failed year switch on the map from lg up, once', async ({ page }) => {
  await page.route(gridOf(2025), (route) => route.abort('connectionrefused'))
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Map of season length in 2026' })).toHaveCount(1)

  await page.getByRole('button', { name: 'Previous year' }).click()

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Could not load the grid for 2025')
  await expect(alert).toHaveCount(1)
  const box = await alert.boundingBox()
  const map = await page.locator('.maplibregl-map').boundingBox()
  if (!box || !map) throw new Error('the alert or the map is not shown')
  expect(box.x).toBeGreaterThanOrEqual(map.x)
  expect(box.x + box.width).toBeLessThanOrEqual(map.x + map.width)
  expect(box.y).toBeGreaterThanOrEqual(map.y)
  // The message on the map says which year it shows, so the phone's chip is not drawn.
  await expect(page.getByText(/^Showing 2026/)).toBeHidden()
})

for (const viewport of [{ width: 1280, height: 800 }, PHONE]) {
  test.describe(`attribution at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport })

    test('shows the attribution on load, with a button that hides and shows it', async ({
      page,
    }) => {
      await page.goto('/')
      const inner = page.locator('.maplibregl-ctrl-attrib-inner')
      await expect(inner).toBeVisible()
      await expect(inner).toContainText('MapLibre')

      await tabTo(page, '.maplibregl-ctrl-attrib-button')
      await page.keyboard.press('Enter')
      await expect(inner).toBeHidden()
      await page.keyboard.press('Enter')
      await expect(inner).toBeVisible()
    })
  })
}

test.describe('in a short desktop window', () => {
  test.use({ viewport: { width: 1280, height: 600 } })

  test('leaves the controls column where the user scrolled it during a Try again by mouse', async ({
    page,
  }) => {
    let failing = true
    await page.route(gridOf(2025), async (route) => {
      if (failing) return route.abort('connectionrefused')
      await wait(2500)
      return route.fallback()
    })
    await page.goto('/?lat=51.5&lon=-0.5')
    await expect(page.getByText('2026 season')).toBeVisible()
    await page.getByRole('button', { name: 'Previous year' }).click()
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Could not load the grid for 2025')

    failing = false
    await alert.getByRole('button', { name: 'Try again' }).click()
    await expect(alert.getByRole('button', { name: 'Trying again…' })).toBeVisible()
    // Meanwhile the user scrolls down the column to read the point panel.
    await page.getByRole('search', { name: 'Find a point' }).hover()
    await page.mouse.wheel(0, 600)
    await expect.poll(() => columnScrollTop(page)).toBeGreaterThan(200)
    const scrolled = await columnScrollTop(page)

    await expect(alert).toHaveCount(0, { timeout: 10_000 })
    // Focus moves on from the button that went with the message, to the map, and the column
    // stays put.
    const focusMoved = () => page.evaluate(() => document.activeElement !== document.body)
    await expect.poll(focusMoved).toBe(true)
    expect(await columnScrollTop(page)).toBe(scrolled)
    await expect(page.locator('canvas.maplibregl-canvas')).toBeFocused()
  })
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
    // Once its data has come in, the page has scrolled as far as block 'start' asks.
    await expect(panel.getByText('2026 season')).toBeVisible()
    await expect.poll(() => revealShortfall(panel)).toBe(0)
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
    await expect(panel.getByText(/\d{4} season/)).toBeVisible()
    await expect.poll(() => revealShortfall(panel)).toBe(0)
  })

  test('shows a failed year switch under the Year slider, in view, and retries it', async ({
    page,
  }) => {
    let failing = true
    await page.route(gridOf(2025), async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300))
      return failing ? route.abort('connectionrefused') : route.fallback()
    })
    await page.goto('/')
    await expect(page.getByRole('region', { name: 'Map of season length in 2026' })).toHaveCount(1)
    // Scrolled down to the controls, which leaves the top of the map above the screen.
    await page.getByRole('search', { name: 'Find a point' }).evaluate((el) => {
      el.scrollIntoView({ block: 'end' })
    })
    expect((await page.locator('.maplibregl-map').boundingBox())?.y).toBeLessThan(0)
    const slider = page.getByRole('slider', { name: 'Year' })
    await slider.focus()
    await page.keyboard.press('ArrowLeft')

    const loading = page.getByRole('status').filter({ hasText: 'Loading 2025' })
    await expect(loading).toHaveCount(1)
    await expect(loading).toBeInViewport()
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Could not load the grid for 2025')
    await expect(alert).toContainText('The map still shows 2026.')
    await expect(alert).toHaveCount(1)
    await expect(alert).toBeInViewport({ ratio: 1 })
    await expectBelow(alert, slider)
    // The map, scrolled out of view, says which year it still shows.
    const chip = page.getByText('Showing 2026 (2025 failed)')
    await expect(chip).toBeVisible()
    await expectInside(chip, page.locator('.maplibregl-map'))

    failing = false
    await alert.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('region', { name: 'Map of season length in 2025' })).toHaveCount(1)
    await expect(page.getByRole('alert')).toHaveCount(0)
    // The focused button went with the message; focus moves to the slider just above it.
    await expect(slider).toBeFocused()
  })

  test('keeps a slow point panel revealed until its data is in', async ({ page }) => {
    const slow = async (route: Route) => {
      await wait(3000)
      return route.fallback()
    }
    await page.route((url) => url.pathname === '/phenology/point', slow)
    await page.route((url) => url.pathname === '/phenology/timeseries', slow)
    await page.goto('/')
    const search = page.getByRole('search', { name: 'Find a point' })
    await expect(search.getByRole('button', { name: 'Find cell' })).toBeEnabled()
    await search.getByLabel('Latitude').fill('51.5')
    await search.getByLabel('Longitude').fill('0.5 W')
    await search.evaluate((el) => el.scrollIntoView({ block: 'end' }))
    await search.getByLabel('Longitude').press('Enter')

    const panel = page.getByRole('region', { name: /Selected point/ })
    await expect(panel.getByText('2026 season')).toBeVisible({ timeout: 10_000 })
    await expect.poll(() => revealShortfall(panel)).toBe(0)
  })

  test('after a first load fails, a Try again by keyboard moves focus to the map, in view', async ({
    page,
  }) => {
    let failing = true
    await page.route(gridOf(2026), (route) =>
      failing ? route.abort('connectionrefused') : route.fallback(),
    )
    await page.goto('/')
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Could not load the grid for 2026')
    // With no grid loaded, the message is on the map.
    await expectInside(alert, page.locator('.maplibregl-map'))

    failing = false
    await tabTo(page, '[role="alert"] button')
    await page.keyboard.press('Enter')

    await expect(alert).toHaveCount(0)
    const canvas = page.locator('canvas.maplibregl-canvas')
    await expect(canvas).toBeFocused()
    await expect(canvas).toBeInViewport({ ratio: 1 })
  })

  test('after a failed year switch, Try again by keyboard brings the Year slider into view', async ({
    page,
  }) => {
    let failing = true
    await page.route(gridOf(2025), (route) =>
      failing ? route.abort('connectionrefused') : route.fallback(),
    )
    await page.goto('/?lat=51.5&lon=-0.5')
    await expect(page.getByText('2026 season')).toBeVisible()
    const slider = page.getByRole('slider', { name: 'Year' })
    await slider.focus()
    await page.keyboard.press('ArrowLeft')
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Could not load the grid for 2025')
    await tabTo(page, '[role="alert"] button')
    // Scrolled on until the slider is above the screen, with Try again still on it.
    const sliderBottom = await slider.evaluate((el) => el.getBoundingClientRect().bottom)
    await page.evaluate((y) => window.scrollBy(0, y + 10), sliderBottom)
    await expect(slider).not.toBeInViewport()
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeInViewport()

    failing = false
    await page.keyboard.press('Enter')

    await expect(alert).toHaveCount(0)
    await expect(slider).toBeFocused()
    await expect(slider).toBeInViewport({ ratio: 1 })
    // With the label, the year it shows and the step buttons, not just the 16px track.
    const group = slider.locator('xpath=../..')
    for (const part of [
      group.getByText('Year', { exact: true }),
      group.locator('span[aria-hidden="true"]').first(),
      group.getByRole('button', { name: 'Previous year' }),
      group.getByRole('button', { name: 'Next year' }),
    ]) {
      await expect(part).toBeInViewport({ ratio: 1 })
    }
  })

  test('shows a year change under the Year slider before any grid has loaded', async ({ page }) => {
    await page.route(
      (url) => url.pathname === '/phenology/grid',
      async (route) => {
        await wait(300)
        return route.abort('connectionrefused')
      },
    )
    await page.goto('/')
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Could not load the grid for 2026')
    // The first load's failure is on the map, at the top of the page.
    await expectInside(alert, page.locator('.maplibregl-map'))
    await page.getByRole('search', { name: 'Find a point' }).evaluate((el) => {
      el.scrollIntoView({ block: 'end' })
    })
    const slider = page.getByRole('slider', { name: 'Year' })
    await slider.focus()
    await page.keyboard.press('ArrowLeft')

    const loading = page.getByRole('status').filter({ hasText: 'Loading 2025' })
    await expect(loading).toHaveCount(1)
    await expect(loading).toBeInViewport({ ratio: 1 })
    await expect(alert).toContainText('Could not load the grid for 2025')
    await expect(alert).toHaveCount(1)
    await expect(alert).toBeInViewport({ ratio: 1 })
    await expectBelow(alert, slider)
  })

  test('gives the attribution button the zoom buttons blue focus glow in the dark theme', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('fpts-theme', 'dark'))
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('.maplibregl-ctrl-attrib-button')).toBeVisible()

    await tabTo(page, '.maplibregl-ctrl-zoom-in')
    const zoomGlow = await drawnGlow(page.locator('.maplibregl-ctrl-zoom-in'))
    await tabTo(page, '.maplibregl-ctrl-attrib-button')
    const attributionGlow = await drawnGlow(page.locator('.maplibregl-ctrl-attrib-button'))

    expect(zoomGlow).toEqual([0, 150, 255])
    expect(attributionGlow).toEqual(zoomGlow)
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
