import { expect, test } from '@playwright/test'

import { mockApi } from './mockApi'

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
  await page.unroute(/./)
  await mockApi(page, { apiDown: true })
  await page.goto('/')

  await expect(page.getByText('API unreachable')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(/could not be reached/i)
})
