import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { gridFor } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import type { PointPanelProps } from '../point-panel/PointPanel'
import { NO_DATA_COLOUR } from './colourScale'
import { MapExplorerPage } from './MapExplorerPage'
import type { PhenologyMapProps } from './PhenologyMap'

/** The props the page last handed to the map. */
const shownMap = vi.hoisted(() => ({ props: null as PhenologyMapProps | null }))

// jsdom has no WebGL: stand in for the map with one button per cell.
vi.mock('./PhenologyMap', () => ({
  PhenologyMap: (props: PhenologyMapProps) => {
    shownMap.props = props
    const { cells, onSelect, label, selected } = props
    return (
      <div role="group" aria-label={label}>
        {selected && <p>Map selection {`${selected.lat}, ${selected.lon}`}</p>}
        {cells.features.map((feature) => (
          <button key={feature.id} type="button" onClick={() => onSelect(feature.properties)}>
            {`Cell ${feature.properties.lat}, ${feature.properties.lon}`}
          </button>
        ))}
      </div>
    )
  },
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

/** Makes the given media queries match (the default jsdom stub matches none). */
function matchMedia(...matching: string[]) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) => ({ matches: matching.includes(query), media: query }) as MediaQueryList,
  )
}

/** The fallback colour of the map's fill expression: the theme's no-data grey. */
function noDataColourOnMap() {
  return shownMap.props?.fillColor.at(-1)
}

// jsdom does not implement scrolling.
const scrollIntoView = vi.fn()
beforeEach(() => {
  shownMap.props = null
  Element.prototype.scrollIntoView = scrollIntoView
})

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
    expect(shownMap.props?.description).toBe('The grid for 2026 could not be loaded.')
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
  it('sets the page title', async () => {
    renderPage()
    await waitFor(() => expect(document.title).toBe('Phenology map · Forest Phenology Explorer'))
  })

  it('colours a value the same in every year', async () => {
    const { user } = renderPage()
    await waitForMap('Map of season length in 2026')
    const fill2026 = shownMap.props?.fillColor

    await user.click(screen.getByRole('button', { name: 'Previous year' }))
    await waitForMap('Map of season length in 2025')

    expect(shownMap.props?.fillColor).toEqual(fill2026)
    expect(screen.getByText('The scale is the same for every year.')).toBeVisible()
  })

  it('keeps the last grid, the selection and the panel when a new year fails to load', async () => {
    let failures = 1
    server.use(
      http.get('*/phenology/grid', async ({ request }) => {
        const year = Number(new URL(request.url).searchParams.get('year'))
        if (year !== 2025) return HttpResponse.json(gridFor(year))
        if (failures > 0) {
          failures -= 1
          return HttpResponse.text('Internal Server Error', { status: 500 })
        }
        await delay(50)
        return HttpResponse.json(gridFor(year))
      }),
    )
    const { user, search } = renderPage('/?lat=51.5&lon=-0.5')
    await waitForMap('Map of season length in 2026')

    await user.click(screen.getByRole('button', { name: 'Previous year' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the grid for 2025')
    expect(alert).toHaveTextContent('The map still shows 2026.')
    const map = screen.getByRole('group', { name: 'Map of season length in 2026' })
    expect(within(map).getAllByRole('button', { name: /^Cell/ })).toHaveLength(121)
    expect(within(map).getByText('Map selection 51.5, -0.5')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Selected point' })).toHaveTextContent(
      'Point 51.5, -0.5 in 2025',
    )
    expect(search().get('lat')).toBe('51.5')
    expect(shownMap.props?.description).toMatch(
      /^The grid for 2025 could not be loaded, so the map still shows 2026\. 121 grid cells/,
    )
    const legend = screen.getByRole('region', { name: 'Legend: Season length' })
    expect(legend).toHaveTextContent('≤ 120 days')

    // Retrying keeps the message (and the focused button) up until the grid arrives.
    const retry = within(alert).getByRole('button', { name: 'Try again' })
    await user.click(retry)
    expect(retry).toHaveFocus()
    expect(retry).toHaveAccessibleName('Trying again…')
    expect(retry).toHaveAttribute('aria-disabled', 'true')
    expect(alert).toBeInTheDocument()

    await waitForMap('Map of season length in 2025')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Selected point' })).toBeInTheDocument()
  })

  it('shows the colour scale, not a claim about missing values, while the grid loads', async () => {
    server.use(
      http.get('*/phenology/grid', async ({ request }) => {
        await delay(50)
        return HttpResponse.json(gridFor(Number(new URL(request.url).searchParams.get('year'))))
      }),
    )
    renderPage()
    expect(await screen.findByText('Loading the grid for 2026…')).toBeInTheDocument()

    const legend = screen.getByRole('region', { name: 'Legend: Season length' })
    expect(legend).toHaveTextContent('≤ 120 days')
    expect(legend).not.toHaveTextContent('No data')
    expect(legend).not.toHaveTextContent(/no value/i)
    expect(shownMap.props?.description).toBe('The grid is loading.')
  })

  it('adds no history entry when the selected cell is selected again', async () => {
    const { user, search, router } = renderPage()
    await waitForMap('Map of season length in 2026')

    await user.click(screen.getByRole('button', { name: 'Cell 51.5, -0.5' }))
    await screen.findByRole('region', { name: 'Selected point' })
    await user.click(screen.getByRole('button', { name: 'Cell 51.5, -0.5' }))
    const form = screen.getByRole('search', { name: 'Find a point' })
    await user.type(within(form).getByLabelText('Latitude'), '51.5')
    await user.type(within(form).getByLabelText('Longitude'), '-0.5')
    await user.click(within(form).getByRole('button', { name: 'Find cell' }))
    expect(search().get('lat')).toBe('51.5')

    // One Back undoes the selection.
    await act(() => router.navigate(-1))
    expect(search().has('lat')).toBe(false)
  })

  it('below lg, scrolls the panel into view and focuses it after a selection on the map', async () => {
    const { user } = renderPage()
    await waitForMap('Map of season length in 2026')

    await user.click(screen.getByRole('button', { name: 'Cell 51.5, -0.5' }))

    const panel = await screen.findByRole('region', { name: 'Selected point' })
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    const scrolled = scrollIntoView.mock.contexts[0] as HTMLElement
    expect(scrolled).toContainElement(panel)
    expect(scrolled).toHaveFocus()

    // Tapping the selected cell again brings the panel back into view too.
    await user.click(screen.getByRole('button', { name: 'Cell 51.5, -0.5' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('below lg, scrolls to the panel after a search but leaves focus on the form', async () => {
    matchMedia('(prefers-reduced-motion: reduce)')
    const { user } = renderPage()
    await waitForMap('Map of season length in 2026')
    const form = screen.getByRole('search', { name: 'Find a point' })

    await user.type(within(form).getByLabelText('Latitude'), '51.5')
    await user.type(within(form).getByLabelText('Longitude'), '-0.5')
    await user.click(within(form).getByRole('button', { name: 'Find cell' }))

    const panel = await screen.findByRole('region', { name: 'Selected point' })
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    // No smooth scrolling for people who ask for less motion.
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
    expect(scrollIntoView.mock.contexts[0]).toContainElement(panel)
    expect(within(form).getByRole('button', { name: 'Find cell' })).toHaveFocus()
    expect(within(form).getByRole('status')).toHaveTextContent('Selected the nearest stored point')
  })

  it('leaves scrolling and focus alone from lg up, where the panel is beside the map', async () => {
    matchMedia('(min-width: 64rem)')
    const { user } = renderPage()
    await waitForMap('Map of season length in 2026')
    const cell = screen.getByRole('button', { name: 'Cell 51.5, -0.5' })

    await user.click(cell)

    await screen.findByRole('region', { name: 'Selected point' })
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(cell).toHaveFocus()
  })

  it('hands the map the dark theme, and follows a theme change', async () => {
    document.documentElement.dataset.theme = 'dark'
    renderPage()
    await waitForMap('Map of season length in 2026')
    expect(shownMap.props?.theme).toBe('dark')
    expect(noDataColourOnMap()).toBe(NO_DATA_COLOUR.dark)

    document.documentElement.dataset.theme = 'light'
    await waitFor(() => expect(shownMap.props?.theme).toBe('light'))
    expect(noDataColourOnMap()).toBe(NO_DATA_COLOUR.light)
  })
})
