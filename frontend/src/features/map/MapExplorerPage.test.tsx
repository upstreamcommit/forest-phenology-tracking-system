import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { gridFor } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import type { PointPanelProps } from '../point-panel/PointPanel'
import { MapExplorerPage } from './MapExplorerPage'
import type { PhenologyMapProps } from './PhenologyMap'

// jsdom has no WebGL: stand in for the map with one button per cell.
vi.mock('./PhenologyMap', () => ({
  PhenologyMap: ({ cells, onSelect, label, selected }: PhenologyMapProps) => (
    <div role="group" aria-label={label}>
      {selected && <p>Map selection {`${selected.lat}, ${selected.lon}`}</p>}
      {cells.features.map((feature) => (
        <button key={feature.id} type="button" onClick={() => onSelect(feature.properties)}>
          {`Cell ${feature.properties.lat}, ${feature.properties.lon}`}
        </button>
      ))}
    </div>
  ),
}))

// The point panel is built and tested separately.
vi.mock('../point-panel/PointPanel', () => ({
  PointPanel: (props: PointPanelProps) => (
    <section aria-label="Selected point">
      <p>{`Point ${props.lat}, ${props.lon} in ${props.year}`}</p>
      <p>{props.inComputedArea ? 'NDVI curve available' : 'No NDVI curve'}</p>
      <p>{`Years ${props.years[0]}-${props.years[props.years.length - 1]}`}</p>
      <button type="button" onClick={props.onClose}>
        Close
      </button>
      <button type="button" onClick={() => props.onSelectYear?.(2020)}>
        Show 2020
      </button>
    </section>
  ),
}))

/** Records the year of every grid request. */
function trackGridRequests() {
  const years: number[] = []
  server.use(
    http.get('*/phenology/grid', ({ request }) => {
      const year = Number(new URL(request.url).searchParams.get('year'))
      years.push(year)
      return HttpResponse.json(gridFor(year))
    }),
  )
  return years
}

function renderPage(route = '/') {
  const user = userEvent.setup()
  const result = renderWithProviders(<MapExplorerPage />, { route })
  const search = () => new URLSearchParams(result.router.state.location.search)
  return { ...result, user, search }
}

async function waitForMap(name: string) {
  const map = await screen.findByRole('group', { name })
  await within(map).findAllByRole('button')
  return map
}

describe('MapExplorerPage', () => {
  it('shows the latest stored year coloured by season length by default', async () => {
    const requested = trackGridRequests()
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: /Phenology map/ })).toBeVisible()
    const map = await waitForMap('Map of season length in 2026')
    expect(within(map).getAllByRole('button')).toHaveLength(121)
    expect(requested).toEqual([2026])

    expect(screen.getByRole('slider', { name: 'Year' })).toHaveAttribute('aria-valuetext', '2026')
    expect(screen.getByRole('radio', { name: 'Season length' })).toBeChecked()
    expect(screen.getByRole('region', { name: 'Legend: Season length' })).toHaveTextContent(
      'NDVI curves available',
    )
    expect(screen.getByText(/No point selected/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Selected point' })).not.toBeInTheDocument()
  })

  it('selects a cell, writes it to the URL and shows the point panel', async () => {
    const { user, search } = renderPage()
    await waitForMap('Map of season length in 2026')

    await user.click(screen.getByRole('button', { name: 'Cell 51.5, -0.5' }))

    expect(search().get('lat')).toBe('51.5')
    expect(search().get('lon')).toBe('-0.5')
    const panel = await screen.findByRole('region', { name: 'Selected point' })
    expect(panel).toHaveTextContent('Point 51.5, -0.5 in 2026')
    expect(panel).toHaveTextContent('NDVI curve available')
    expect(panel).toHaveTextContent('Years 2016-2026')
    expect(screen.getByText('Map selection 51.5, -0.5')).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: 'Close' }))
    expect(search().has('lat')).toBe(false)
    expect(search().has('lon')).toBe(false)
    expect(screen.queryByRole('region', { name: 'Selected point' })).not.toBeInTheDocument()
    expect(screen.getByText(/No point selected/)).toHaveFocus()
  })

  it('passes stored coordinates through exactly', async () => {
    const lon = -0.30000000000000004
    const grid = gridFor(2026)
    grid.features[0].geometry.coordinates = [lon, 51.300000000000004]
    server.use(http.get('*/phenology/grid', () => HttpResponse.json(grid)))
    const { user, search } = renderPage()
    await waitForMap('Map of season length in 2026')

    await user.click(
      screen.getByRole('button', { name: 'Cell 51.300000000000004, -0.30000000000000004' }),
    )

    expect(search().get('lon')).toBe('-0.30000000000000004')
    expect(search().get('lat')).toBe('51.300000000000004')
    expect(await screen.findByRole('region', { name: 'Selected point' })).toHaveTextContent(
      'Point 51.300000000000004, -0.30000000000000004 in 2026',
    )
  })

  it('switches the metric in the URL', async () => {
    const { user, search } = renderPage()
    await waitForMap('Map of season length in 2026')

    await user.click(screen.getByRole('radio', { name: 'Start of season' }))

    expect(search().get('metric')).toBe('sos')
    expect(screen.getByRole('radio', { name: 'Start of season' })).toBeChecked()
    expect(screen.getByRole('group', { name: 'Map of start of season in 2026' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Legend: Start of season' })).toBeVisible()
  })

  it('changes the year, refetches the grid and keeps the selected point', async () => {
    const requested = trackGridRequests()
    const { user, search } = renderPage('/?lat=51.5&lon=-0.5')
    await waitForMap('Map of season length in 2026')
    expect(await screen.findByRole('region', { name: 'Selected point' })).toHaveTextContent(
      'in 2026',
    )

    await user.click(screen.getByRole('button', { name: 'Previous year' }))

    expect(search().get('year')).toBe('2025')
    await waitForMap('Map of season length in 2025')
    expect(requested).toEqual([2026, 2025])
    expect(screen.getByRole('slider', { name: 'Year' })).toHaveAttribute('aria-valuetext', '2025')
    expect(screen.getByRole('region', { name: 'Selected point' })).toHaveTextContent(
      'Point 51.5, -0.5 in 2025',
    )
    expect(search().get('lat')).toBe('51.5')
  })

  it('shows loading states, keeping the current year while the next one loads', async () => {
    server.use(
      http.get('*/phenology/grid', async ({ request }) => {
        await delay(50)
        return HttpResponse.json(gridFor(Number(new URL(request.url).searchParams.get('year'))))
      }),
    )
    const { user } = renderPage()
    expect(await screen.findByText('Loading the grid for 2026…')).toBeInTheDocument()
    await waitForMap('Map of season length in 2026')
    expect(screen.queryByText('Loading the grid for 2026…')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Previous year' }))

    expect(await screen.findByText('Loading 2025…')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Map of season length in 2026' })).toBeVisible()
    await waitForMap('Map of season length in 2025')
    expect(screen.queryByText('Loading 2025…')).not.toBeInTheDocument()
  })

  it('lets the point panel pick the year', async () => {
    const { user, search } = renderPage('/?lat=51.5&lon=-0.5')
    const panel = await screen.findByRole('region', { name: 'Selected point' })

    await user.click(within(panel).getByRole('button', { name: 'Show 2020' }))

    expect(search().get('year')).toBe('2020')
    await waitForMap('Map of season length in 2020')
  })

  it('reads year, metric and point from the URL', async () => {
    renderPage('/?year=2020&metric=eos&lat=51.5&lon=-0.5')

    await waitForMap('Map of end of season in 2020')
    expect(screen.getByRole('radio', { name: 'End of season' })).toBeChecked()
    expect(screen.getByRole('slider', { name: 'Year' })).toHaveAttribute('aria-valuetext', '2020')
    expect(await screen.findByRole('region', { name: 'Selected point' })).toHaveTextContent(
      'Point 51.5, -0.5 in 2020',
    )
  })

  it('ignores invalid URL values and points that are not stored', async () => {
    renderPage('/?year=1990&metric=bogus&lat=51.55&lon=-0.5')

    await waitForMap('Map of season length in 2026')
    expect(screen.getByRole('radio', { name: 'Season length' })).toBeChecked()
    expect(screen.queryByRole('region', { name: 'Selected point' })).not.toBeInTheDocument()
  })

  it('finds the nearest stored cell by coordinates and rejects a far-away point', async () => {
    const { user, search } = renderPage()
    await waitForMap('Map of season length in 2026')
    const form = screen.getByRole('search', { name: 'Find a point' })

    await user.type(within(form).getByLabelText('Latitude'), '51.53')
    await user.type(within(form).getByLabelText('Longitude'), '-0.47')
    await user.click(within(form).getByRole('button', { name: 'Find cell' }))

    expect(search().get('lat')).toBe('51.5')
    expect(search().get('lon')).toBe('-0.5')
    expect(await screen.findByRole('region', { name: 'Selected point' })).toBeVisible()

    await user.clear(within(form).getByLabelText('Latitude'))
    await user.clear(within(form).getByLabelText('Longitude'))
    await user.type(within(form).getByLabelText('Latitude'), '40')
    await user.type(within(form).getByLabelText('Longitude'), '-3')
    await user.click(within(form).getByRole('button', { name: 'Find cell' }))

    expect(within(form).getByRole('alert')).toHaveTextContent(/no stored grid point near/)
    expect(search().get('lat')).toBe('51.5')
  })

  it('shows an error when the grid cannot be loaded', async () => {
    server.use(
      http.get('*/phenology/grid', () =>
        HttpResponse.text('Internal Server Error', { status: 500 }),
      ),
    )
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the grid for 2026')
    expect(alert).toHaveTextContent('The API had an internal problem. Try again in a moment.')
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('shows an error when the catalog cannot be loaded', async () => {
    server.use(http.get('*/catalog', () => HttpResponse.json({}, { status: 503 })))
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the list of datasets')
  })

  it('says so when no product has stored metrics', async () => {
    server.use(
      http.get('*/catalog', () =>
        HttpResponse.json({ default_threshold_frac: 0.5, products: [] }),
      ),
    )
    renderPage()

    expect(await screen.findByText('No stored metrics to map')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('group')).not.toBeInTheDocument())
  })
})
