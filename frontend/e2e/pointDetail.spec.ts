import { expect, test } from '@playwright/test'

import { mockApi } from './mockApi'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test('opens a point from the map panel and shows its stored season and NDVI curve', async ({
  page,
}) => {
  await page.goto('/?year=2021&lat=51.5&lon=-0.5')
  await page.getByRole('link', { name: 'Open point details' }).click()

  await expect(page).toHaveURL(/\/point\/51\.5\/-0\.5\?year=2021$/)
  await expect(page).toHaveTitle('51.50° N, 0.50° W · Forest Phenology Explorer')
  await expect(page.getByRole('heading', { level: 1, name: '51.50° N, 0.50° W' })).toBeVisible()
  await expect(page.getByRole('figure', { name: 'NDVI through 2021 at 51.50° N, 0.50° W' })).toBeVisible()
  await expect(page.getByText('Computed season: 7 Apr 2021 to 16 Oct 2021, 192 days.')).toBeVisible()

  await page.getByRole('link', { name: 'Back to the map' }).click()
  await expect(page).toHaveURL(/\/\?year=2021&lat=51\.5&lon=-0\.5$/)
  await expect(page.getByRole('region', { name: /Selected point/ })).toBeVisible()
})

test('moves the season threshold with the keyboard and resets it', async ({ page }) => {
  await page.goto('/point/51.5/-0.5?year=2021')
  const slider = page.getByRole('slider', { name: 'Season threshold' })
  await expect(slider).toHaveAttribute('aria-valuetext', '50% of the seasonal amplitude')

  await slider.focus()
  await page.keyboard.press('Home')
  await expect(slider).toHaveAttribute('aria-valuetext', '5% of the seasonal amplitude')
  await expect(page).toHaveURL(/threshold=0\.05/)

  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuetext', '15% of the seasonal amplitude')
  await expect(page).toHaveURL(/threshold=0\.15/)

  await page.getByRole('button', { name: 'Reset the threshold to 50%' }).click()
  await expect(slider).toHaveAttribute('aria-valuetext', '50% of the seasonal amplitude')
  await expect(page).not.toHaveURL(/threshold=/)
  await expect(slider).toBeFocused()
})

const valueText = (frac: string) => `${Math.round(Number(frac) * 100)}% of the seasonal amplitude`

for (const [raw, snapped, key, next] of [
  ['0.02', '0.05', 'ArrowRight', '0.1'],
  ['0.97', '0.95', 'ArrowLeft', '0.9'],
] as const) {
  test(`snaps threshold=${raw} from the URL to the slider's ${snapped}`, async ({ page }) => {
    const request = page.waitForRequest((r) => r.url().includes('/phenology/point/ndvi'))
    await page.goto(`/point/51.5/-0.5?year=2021&threshold=${raw}`)
    expect(new URL((await request).url()).searchParams.get('threshold_frac')).toBe(snapped)

    const slider = page.getByRole('slider', { name: 'Season threshold' })
    await expect(slider).toHaveValue(snapped)
    await expect(slider).toHaveAttribute('aria-valuetext', valueText(snapped))

    await slider.focus()
    await page.keyboard.press(key)
    await expect(slider).toHaveValue(next)
    await expect(slider).toHaveAttribute('aria-valuetext', valueText(next))
    await expect(page).toHaveURL(new RegExp(`threshold=${next.replace('.', '\\.')}$`))
  })
}

test('names an off-grid point with the decimals it needs', async ({ page }) => {
  await page.goto('/point/51.495/-0.495?year=2020')
  await expect(page).toHaveTitle('51.495° N, 0.495° W · Forest Phenology Explorer')
  await expect(page.getByRole('heading', { level: 1, name: '51.495° N, 0.495° W' })).toBeVisible()
  await expect(
    page.getByRole('figure', { name: 'NDVI through 2020 at 51.495° N, 0.495° W' }),
  ).toBeVisible()
})

test('explains that points outside the stack have no NDVI curve', async ({ page }) => {
  await page.goto('/point/55.5/-3.5?year=2021')
  await expect(page.getByText(/NDVI curves exist only inside/i)).toBeVisible()
  await page.getByRole('link', { name: 'Open an example point inside the area' }).click()
  await expect(page).toHaveURL(/\/point\/51\.5\/-0\.5/)
})

test('rejects an invalid location in the URL', async ({ page }) => {
  await page.goto('/point/north/west')
  await expect(page.getByText(/not a valid location/i)).toBeVisible()
})
