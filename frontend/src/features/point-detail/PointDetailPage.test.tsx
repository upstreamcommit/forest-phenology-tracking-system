import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { catalog, ndviCurveFor } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import type { NdviCurveChartProps } from '../charts/NdviCurveChart'
import { PointDetailPage } from './PointDetailPage'

// The chart is built and tested separately: stand in for it with the props it gets.
vi.mock('../charts/NdviCurveChart', () => ({
  NdviCurveChart: ({ curve, stored, title }: NdviCurveChartProps) => (
    <figure aria-label={title}>
      <p>{`Curve ${curve.year} at threshold ${curve.threshold_frac}`}</p>
      <p>{`Stored ${stored?.sos_date ?? 'none'} to ${stored?.eos_date ?? 'none'}`}</p>
    </figure>
  ),
}))

const NOT_FOUND = { detail: 'No phenology data found' }

/** Records the query of every NDVI curve request, answering with the fixture curve. */
function trackNdviRequests({ slowFrom = 0 }: { slowFrom?: number } = {}) {
  const requests: URLSearchParams[] = []
  server.use(
    http.get('*/phenology/point/ndvi', async ({ request }) => {
      const query = new URL(request.url).searchParams
      requests.push(query)
      if (requests.length > slowFrom && slowFrom > 0) await delay(100)
      const n = (name: string) => Number(query.get(name))
      return HttpResponse.json(
        ndviCurveFor(n('lat'), n('lon'), n('year'), n('threshold_frac') || 0.5),
      )
    }),
  )
  return requests
}

function renderPage(route = '/point/51.5/-0.5?year=2022') {
  const user = userEvent.setup()
  const result = renderWithProviders(<PointDetailPage />, {
    route,
    path: '/point/:lat/:lon',
    routes: [{ path: '/', element: <p>Map page</p> }],
  })
  const search = () => new URLSearchParams(result.router.state.location.search)
  return { ...result, user, search }
}

/** Renders the page and waits for the catalog, so both sections are on screen. */
async function renderLoaded(route?: string) {
  const result = renderPage(route)
  await screen.findByRole('region', { name: 'Stored season' })
  return result
}

function storedSection() {
  return screen.getByRole('region', { name: 'Stored season' })
}

function ndviSection() {
  return screen.getByRole('region', { name: 'NDVI curve' })
}

/** The stat tile with this label (a dt and its dd values). */
function stat(label: string) {
  return within(storedSection()).getByText(label, { selector: 'dt' }).parentElement!
}

/** The availability line in the header for this label. */
function availability(label: string) {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling
}

describe('PointDetailPage', () => {
  it('shows the stored season, its comparison and the season record', async () => {
    renderPage()

    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('51.50° N, 0.50° W')
    expect(screen.getByText('Synthetic')).toBeInTheDocument()
    expect(
      await within(storedSection()).findByRole('heading', { name: '2022 season' }),
    ).toBeInTheDocument()

    expect(stat('Start of season')).toHaveTextContent('3 Apr 2022day 93')
    expect(stat('End of season')).toHaveTextContent('4 Oct 2022day 277')
    expect(stat('Season length')).toHaveTextContent('184 days')
    expect(stat('Land cover')).toHaveTextContent('Forest')
    expect(
      await screen.findByText("Season 14 days shorter than this point's 2016–2026 average"),
    ).toBeInTheDocument()
    expect(screen.getByText('Ended 15 days earlier than average')).toBeInTheDocument()

    const chart = screen.getByRole('figure', { name: 'Season timing, 2016–2026' })
    expect(within(chart).getByRole('button', { name: /^2022:/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(availability('Stored metrics')).toHaveTextContent('Yes, 2016–2026')
    expect(availability('NDVI curve')).toHaveTextContent('Yes, 2016–2026')
  })

  it('shows the NDVI curve inside the computed area, compared with the stored dates', async () => {
    const requests = trackNdviRequests()
    await renderLoaded()

    const chart = await within(ndviSection()).findByRole('figure', {
      name: 'NDVI through 2022 at 51.50° N, 0.50° W',
    })
    expect(chart).toHaveTextContent('Curve 2022 at threshold 0.5')
    await waitFor(() => expect(chart).toHaveTextContent('Stored 2022-04-03 to 2022-10-04'))

    expect(requests).toHaveLength(1)
    expect(Object.fromEntries(requests[0])).toEqual({
      product: 'ndvi_synth',
      year: '2022',
      lat: '51.5',
      lon: '-0.5',
      threshold_frac: '0.5',
    })

    const section = ndviSection()
    expect(within(section).getByText('Computed season: 7 Apr 2022 to 30 Sept 2022, 176 days.'))
      .toBeInTheDocument()
    expect(
      within(section).getByText(
        'Computed start 7 Apr, 4 days after the stored start (3 Apr 2022).',
      ),
    ).toBeInTheDocument()
    expect(
      within(section).getByText('Computed end 30 Sept, 4 days before the stored end (4 Oct 2022).'),
    ).toBeInTheDocument()
    expect(section).toHaveTextContent(
      'Composites are 16 days apart, so computed and stored dates can differ by up to about one ' +
        'composite.',
    )
    expect(section).toHaveTextContent(/plus 50% of the seasonal amplitude .*: NDVI 0\.45 here\./)

    const slider = within(section).getByRole('slider', { name: 'Season threshold' })
    expect(slider).toHaveAttribute('aria-valuetext', '50% of the seasonal amplitude')
    expect(slider).toHaveAccessibleDescription(/The season starts at the first 16-day composite/)
    expect(within(section).getByRole('button', { name: /^Reset/ })).toBeDisabled()
  })

  it('explains where curves exist for a point outside the area, without a request', async () => {
    const requests = trackNdviRequests()
    await renderLoaded('/point/53.5/-2?year=2022')

    await within(storedSection()).findByRole('heading', { name: '2022 season' })
    const info = within(ndviSection()).getByRole('status')
    expect(info).toHaveTextContent('No NDVI curve for this location')
    expect(info).toHaveTextContent(
      'NDVI curves exist only inside the area outlined on the map: latitude 50.995° N to ' +
        '52.005° N, longitude 1.005° W to 0.005° E, for 2016–2026.',
    )
    expect(
      within(info).getByRole('link', { name: /Open an example point inside the area/ }),
    ).toHaveAttribute('href', '/point/51.5/-0.5?year=2022')
    expect(availability('NDVI curve')).toHaveTextContent('No, outside the area with NDVI curves')
    expect(screen.queryByRole('slider', { name: 'Season threshold' })).not.toBeInTheDocument()
    expect(requests).toHaveLength(0)
  })

  it('makes no NDVI request for a year the stack does not cover', async () => {
    const requests = trackNdviRequests()
    const product = catalog.products[0]
    server.use(
      http.get('*/catalog', () =>
        HttpResponse.json({
          ...catalog,
          products: [{ ...product, computed: { ...product.computed!, years: [2019, 2020] } }],
        }),
      ),
    )
    await renderLoaded()

    expect(
      await within(ndviSection()).findByText('No NDVI curve for 2022'),
    ).toBeInTheDocument()
    expect(ndviSection()).toHaveTextContent('NDVI curves here cover 2019–2020.')
    expect(availability('NDVI curve')).toHaveTextContent('Not for 2022, only 2019–2020')
    await within(storedSection()).findByRole('heading', { name: '2022 season' })
    expect(requests).toHaveLength(0)
  })

  it('changes the threshold in the URL and refetches the curve with it', async () => {
    const requests = trackNdviRequests()
    const { router, search } = await renderLoaded()
    const slider = await within(ndviSection()).findByRole('slider', { name: 'Season threshold' })
    await within(ndviSection()).findByText(/Curve 2022 at threshold 0.5/)

    fireEvent.change(slider, { target: { value: '0.6' } })

    expect(search().get('threshold')).toBe('0.6')
    expect(search().get('year')).toBe('2022')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(slider).toHaveAttribute('aria-valuetext', '60% of the seasonal amplitude')
    expect(await within(ndviSection()).findByText('Curve 2022 at threshold 0.6')).toBeVisible()
    expect(requests.map((q) => q.get('threshold_frac'))).toEqual(['0.5', '0.6'])
    expect(within(ndviSection()).getByRole('button', { name: /^Reset/ })).toBeEnabled()
  })

  it('drops the threshold from the URL when the slider returns to the default', async () => {
    const requests = trackNdviRequests()
    const { search } = await renderLoaded('/point/51.5/-0.5?year=2022&threshold=0.6')
    const slider = await within(ndviSection()).findByRole('slider', { name: 'Season threshold' })
    await within(ndviSection()).findByText('Curve 2022 at threshold 0.6')

    fireEvent.change(slider, { target: { value: '0.5' } })

    expect(search().has('threshold')).toBe(false)
    expect(search().get('year')).toBe('2022')
    expect(slider).toHaveAttribute('aria-valuetext', '50% of the seasonal amplitude')
    expect(await within(ndviSection()).findByText('Curve 2022 at threshold 0.5')).toBeVisible()
    expect(requests.map((q) => q.get('threshold_frac'))).toEqual(['0.6', '0.5'])
  })

  it('says the stored season belongs to the default threshold when another is chosen', async () => {
    trackNdviRequests()
    await renderLoaded('/point/51.5/-0.5?year=2022&threshold=0.6')

    const section = ndviSection()
    await within(section).findByText('Curve 2022 at threshold 0.6')
    expect(await within(section).findByText(/stored start \(3 Apr 2022\)/)).toBeInTheDocument()
    expect(section).toHaveTextContent(
      'Stored seasons are derived at the default threshold of 50%, so at 60% this is not a ' +
        'like-for-like comparison.',
    )
    expect(section).not.toHaveTextContent(/expected to move/)
    expect(section).not.toHaveTextContent(/up to about one composite/)
  })

  it('gives the threshold in the explanation to three decimals at most', async () => {
    // As the API answers for (51.1, -0.4) in 2021 at 85%: a composite 0.000002 below it.
    server.use(
      http.get('*/phenology/point/ndvi', ({ request }) => {
        const query = new URL(request.url).searchParams
        const n = (name: string) => Number(query.get(name))
        const curve = ndviCurveFor(n('lat'), n('lon'), n('year'))
        const observations = curve.observations.map((obs, i) =>
          i === 18 ? { ...obs, ndvi: 0.703951 } : obs,
        )
        return HttpResponse.json({ ...curve, observations, threshold_ndvi: 0.703953 })
      }),
    )
    await renderLoaded()

    const section = ndviSection()
    await within(section).findByText('Curve 2022 at threshold 0.5')
    expect(section).toHaveTextContent(/of the seasonal amplitude .*: NDVI 0\.704 here\./)
  })

  it('keeps the previous curve on screen while a new threshold loads', async () => {
    trackNdviRequests({ slowFrom: 1 })
    await renderLoaded()
    const slider = await within(ndviSection()).findByRole('slider', { name: 'Season threshold' })
    await within(ndviSection()).findByText('Curve 2022 at threshold 0.5')

    fireEvent.change(slider, { target: { value: '0.7' } })

    expect(await within(ndviSection()).findByText('Updating…')).toBeInTheDocument()
    expect(within(ndviSection()).getByText('Curve 2022 at threshold 0.5')).toBeInTheDocument()
    expect(await within(ndviSection()).findByText('Curve 2022 at threshold 0.7')).toBeVisible()
    expect(within(ndviSection()).queryByText('Updating…')).not.toBeInTheDocument()
  })

  it('resets the threshold to the catalog default', async () => {
    const requests = trackNdviRequests()
    const { user, search } = await renderLoaded('/point/51.5/-0.5?year=2022&threshold=0.6')
    const slider = await within(ndviSection()).findByRole('slider', { name: 'Season threshold' })
    expect(slider).toHaveAttribute('aria-valuetext', '60% of the seasonal amplitude')
    await within(ndviSection()).findByText('Curve 2022 at threshold 0.6')

    const reset = within(ndviSection()).getByRole('button', {
      name: 'Reset the threshold to 50%',
    })
    await user.click(reset)

    expect(search().has('threshold')).toBe(false)
    expect(slider).toHaveAttribute('aria-valuetext', '50% of the seasonal amplitude')
    expect(slider).toHaveFocus()
    expect(reset).toBeDisabled()
    expect(await within(ndviSection()).findByText('Curve 2022 at threshold 0.5')).toBeVisible()
    expect(requests.map((q) => q.get('threshold_frac'))).toEqual(['0.6', '0.5'])
  })

  it('falls back to the defaults for an invalid year and threshold', async () => {
    const requests = trackNdviRequests()
    renderPage('/point/51.5/-0.5?year=1990&threshold=1.5')

    expect(
      await within(await screen.findByRole('region', { name: 'NDVI curve' })).findByText(
        'Curve 2026 at threshold 0.5',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Year' })).toHaveAttribute('aria-valuetext', '2026')
    expect(requests[0].get('year')).toBe('2026')
    expect(requests[0].get('threshold_frac')).toBe('0.5')
  })

  it.each([
    ['0.33', '0.35', '35%'],
    ['0.02', '0.05', '5%'],
    ['0.97', '0.95', '95%'],
  ])('snaps threshold=%s from the URL to the slider, %s', async (raw, value, percent) => {
    const requests = trackNdviRequests()
    await renderLoaded(`/point/51.5/-0.5?year=2022&threshold=${raw}`)

    const slider = await screen.findByRole('slider', { name: 'Season threshold' })
    expect(slider).toHaveValue(value)
    expect(slider).toHaveAttribute('aria-valuetext', `${percent} of the seasonal amplitude`)
    expect(within(ndviSection()).getByText(percent)).toBeInTheDocument()
    await within(ndviSection()).findByText(`Curve 2022 at threshold ${value}`)
    expect(requests.map((q) => q.get('threshold_frac'))).toEqual([value])
  })

  it('changes the year for both sections from the year slider and the season record', async () => {
    const requests = trackNdviRequests()
    const { user, router, search } = await renderLoaded()
    await within(storedSection()).findByRole('heading', { name: '2022 season' })
    await within(ndviSection()).findByText('Curve 2022 at threshold 0.5')

    await user.click(screen.getByRole('button', { name: 'Previous year' }))

    expect(search().get('year')).toBe('2021')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(
      await within(storedSection()).findByRole('heading', { name: '2021 season' }),
    ).toBeInTheDocument()
    expect(stat('Start of season')).toHaveTextContent('11 Apr 2021')
    expect(
      await within(ndviSection()).findByRole('figure', {
        name: 'NDVI through 2021 at 51.50° N, 0.50° W',
      }),
    ).toHaveTextContent('Stored 2021-04-11 to 2021-10-20')
    expect(requests.map((q) => q.get('year'))).toEqual(['2022', '2021'])
    expect(screen.getByRole('button', { name: /^2021:/ })).toHaveAttribute('aria-current', 'true')

    await user.click(screen.getByRole('button', { name: /^2019:/ }))

    expect(search().get('year')).toBe('2019')
    expect(screen.getByRole('slider', { name: 'Year' })).toHaveAttribute('aria-valuetext', '2019')
    expect(
      await within(storedSection()).findByRole('heading', { name: '2019 season' }),
    ).toBeInTheDocument()
  })

  it('compares the curve only with the stored season of its own year', async () => {
    let release = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get('*/phenology/point/ndvi', async ({ request }) => {
        const query = new URL(request.url).searchParams
        // The 2021 curve arrives only when the test says so.
        if (query.get('year') === '2021') await released
        const n = (name: string) => Number(query.get(name))
        return HttpResponse.json(ndviCurveFor(n('lat'), n('lon'), n('year')))
      }),
    )
    const { user } = await renderLoaded()
    await within(ndviSection()).findByText('Stored 2022-04-03 to 2022-10-04')

    await user.click(screen.getByRole('button', { name: 'Previous year' }))

    // The stored 2021 season is in while the 2022 curve is still on screen.
    await within(storedSection()).findByRole('heading', { name: '2021 season' })
    const section = ndviSection()
    expect(within(section).getByText('Curve 2022 at threshold 0.5')).toBeInTheDocument()
    expect(within(section).getByText('Updating…')).toBeInTheDocument()
    expect(within(section).getByText('Stored none to none')).toBeInTheDocument()
    expect(section).not.toHaveTextContent(/stored (start|end)/)

    release()
    expect(await within(section).findByText('Curve 2021 at threshold 0.5')).toBeVisible()
    expect(within(section).getByText('Stored 2021-04-11 to 2021-10-20')).toBeInTheDocument()
    expect(section).toHaveTextContent(/the stored start \(11 Apr 2021\)/)
  })

  it.each([
    ['/point/51.495/-0.495?year=2020', '51.495° N, 0.495° W'],
    ['/point/51.49/-0.49?year=2020', '51.49° N, 0.49° W'],
  ])('names %s precisely enough to tell it from nearby points', async (route, name) => {
    trackNdviRequests()
    await renderLoaded(route)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(name)
    expect(document.title).toBe(`${name} · Forest Phenology Explorer`)
    expect(
      await within(ndviSection()).findByRole('figure', { name: `NDVI through 2020 at ${name}` }),
    ).toBeInTheDocument()
  })

  it.each([
    ['/point/abc/-0.5'],
    ['/point/95/-0.5'],
    ['/point/51.5/200?year=2022'],
  ])('says %s is not a valid location', async (route) => {
    const { user } = renderPage(route)

    expect(screen.getByRole('heading', { level: 1, name: 'Not a valid location' })).toBeVisible()
    expect(document.title).toBe('Not a valid location · Forest Phenology Explorer')
    const back = screen.getByRole('link', { name: 'Back to the map' })
    expect(back).toHaveAttribute('href', '/')
    expect(screen.queryByRole('region')).not.toBeInTheDocument()

    await user.click(back)
    expect(screen.getByText('Map page')).toBeInTheDocument()
  })

  it('shows an off-grid point as info and still draws its curve', async () => {
    server.use(
      http.get('*/phenology/point', () => HttpResponse.json(NOT_FOUND, { status: 404 })),
      http.get('*/phenology/timeseries', () => HttpResponse.json(NOT_FOUND, { status: 404 })),
    )
    await renderLoaded('/point/51.55/-0.5?year=2022')

    expect(
      await within(storedSection()).findByText('This location is not on the stored 0.1° grid'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(availability('Stored metrics')).toHaveTextContent('No, not on the stored 0.1° grid')

    const chart = await within(ndviSection()).findByRole('figure', {
      name: 'NDVI through 2022 at 51.55° N, 0.50° W',
    })
    expect(chart).toHaveTextContent('Stored none to none')
    expect(
      within(ndviSection()).getByText('Computed season: 7 Apr 2022 to 30 Sept 2022, 176 days.'),
    ).toBeInTheDocument()
    expect(ndviSection()).not.toHaveTextContent(/stored start/)
  })

  it('says when the NDVI stack does not cover the point', async () => {
    server.use(
      http.get('*/phenology/point/ndvi', () =>
        HttpResponse.json(
          {
            error: 'out_of_coverage',
            message: 'Location (51.5, -0.5) is outside the raster coverage.',
          },
          { status: 422 },
        ),
      ),
    )
    await renderLoaded()

    const message = await within(ndviSection()).findByText('No NDVI curve at this point')
    expect(message.closest('[role="status"]')).toHaveTextContent(
      'Location (51.5, -0.5) is outside the raster coverage.',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: 'Season threshold' })).not.toBeInTheDocument()
  })

  it('gives the threshold as many decimals as the chart when a value rounds to it', async () => {
    server.use(
      http.get('*/phenology/point/ndvi', () => {
        const curve = ndviCurveFor(51.5, -0.5, 2022)
        const [first, ...rest] = curve.observations
        return HttpResponse.json({
          ...curve,
          observations: [{ ...first, ndvi: 0.405426 }, ...rest],
          threshold_ndvi: 0.405996,
        })
      }),
    )
    await renderLoaded()

    expect(
      await within(ndviSection()).findByText(/NDVI 0\.406 here/, { exact: false }),
    ).toBeInTheDocument()
  })

  it('says when there is no NDVI curve for the year', async () => {
    server.use(
      http.get('*/phenology/point/ndvi', () => HttpResponse.json(NOT_FOUND, { status: 404 })),
    )
    await renderLoaded()

    const title = await within(ndviSection()).findByText('No NDVI curve for 2022')
    expect(title.closest('[role="status"]')).toHaveTextContent('No phenology data found')
    expect(
      await within(storedSection()).findByRole('heading', { name: '2022 season' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: 'Season threshold' })).not.toBeInTheDocument()
  })

  it.each([
    ['a flat series', 'This NDVI series is flat', 0.3],
    ['an empty series', 'This pixel has no NDVI values for the year', null],
  ])('says %s has no season at any threshold', async (_, reason, ndvi) => {
    server.use(
      http.get('*/phenology/point/ndvi', () => {
        const curve = ndviCurveFor(51.5, -0.5, 2022)
        return HttpResponse.json({
          ...curve,
          observations: ndvi === null ? [] : curve.observations.map((o) => ({ ...o, ndvi })),
          threshold_ndvi: null,
          sos_date: null,
          eos_date: null,
          season_length: null,
        })
      }),
    )
    await renderLoaded()

    const section = ndviSection()
    expect(await within(section).findByText('Computed season: none.')).toBeInTheDocument()
    const explanation = `(highest minus lowest NDVI). ${reason}, so no threshold finds a season.`
    expect(section).toHaveTextContent(explanation)
    expect(
      within(section).getByRole('slider', { name: 'Season threshold' }),
    ).toHaveAccessibleDescription(expect.stringContaining(explanation))
    expect(section).not.toHaveTextContent(/at this threshold|stored (start|end)/)
  })

  it('shows a server error for the curve and recovers on retry', async () => {
    server.use(
      http.get('*/phenology/point/ndvi', () =>
        HttpResponse.text('Internal Server Error', { status: 500 }),
      ),
    )
    const { user } = await renderLoaded()

    const alert = await within(ndviSection()).findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the NDVI curve')
    expect(alert).toHaveTextContent('The API had an internal problem. Try again in a moment.')
    expect(
      await within(storedSection()).findByRole('heading', { name: '2022 season' }),
    ).toBeInTheDocument()

    server.resetHandlers()
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(
      await within(ndviSection()).findByRole('figure', { name: /^NDVI through 2022/ }),
    ).toBeInTheDocument()
    expect(within(ndviSection()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('links back to the map with the year and the exact coordinates', async () => {
    const { user } = renderPage()
    const back = await screen.findByRole('link', { name: 'Back to the map' })
    expect(back).toHaveAttribute('href', '/?year=2022&lat=51.5&lon=-0.5')

    await user.click(back)
    expect(screen.getByText('Map page')).toBeInTheDocument()
  })

  it('keeps unrounded coordinates in the back link', async () => {
    renderPage('/point/51.300000000000004/-0.30000000000000004')
    expect(await screen.findByRole('link', { name: 'Back to the map' })).toHaveAttribute(
      'href',
      '/?year=2026&lat=51.300000000000004&lon=-0.30000000000000004',
    )
  })

  it('sets the page title to the coordinates', async () => {
    renderPage()
    await screen.findByRole('region', { name: 'Stored season' })
    expect(document.title).toBe('51.50° N, 0.50° W · Forest Phenology Explorer')
  })

  it('shows an error when the catalog cannot be loaded', async () => {
    server.use(http.get('*/catalog', () => HttpResponse.json({}, { status: 503 })))
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the list of datasets')
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeEnabled()
  })
})
