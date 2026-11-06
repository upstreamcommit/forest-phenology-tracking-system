import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { gridFor } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import type { PointPanelProps } from '../point-panel/PointPanel'
import { NO_DATA_COLOUR } from './colourScale'
import { MapExplorerPage } from './MapExplorerPage'
import { COLOUR_DOMAINS } from './metrics'
import type { PhenologyMapProps } from './PhenologyMap'

/** The props the page last handed to the map. */
const shownMap = vi.hoisted(() => ({ props: null as PhenologyMapProps | null }))

// jsdom has no WebGL: stand in for the map with one button per cell. The group stands in for
// the canvas, the map's tab stop.
vi.mock('./PhenologyMap', async () => {
  const { useImperativeHandle, useRef } = await import('react')
  return {
    PhenologyMap: (props: PhenologyMapProps) => {
      shownMap.props = props
      const { cells, onSelect, label, selected, ref } = props
      const group = useRef<HTMLDivElement>(null)
      useImperativeHandle(ref, () => ({ canvas: () => group.current }), [])
      return (
        <div ref={group} role="group" aria-label={label} tabIndex={-1}>
          {selected && <p>Map selection {`${selected.lat}, ${selected.lon}`}</p>}
          {cells.features.map((feature) => (
            <button key={feature.id} type="button" onClick={() => onSelect(feature.properties)}>
              {`Cell ${feature.properties.lat}, ${feature.properties.lon}`}
            </button>
          ))}
        </div>
      )
    },
  }
})

// The point panel is built and tested separately. This one makes the panel's queries, which the
// page watches.
vi.mock('../point-panel/PointPanel', async () => {
  const { usePointMetric, useTimeseries } = await import('../../api/queries')
  return {
    PointPanel: (props: PointPanelProps) => {
      const { product, year, years, lat, lon } = props
      usePointMetric({ product, year, lat, lon })
      useTimeseries({ product, lat, lon, startYear: years[0], endYear: years[years.length - 1] })
      return (
        <section aria-label="Selected point">
          <p>{`Point ${lat}, ${lon} in ${year}`}</p>
          <p>{props.inComputedArea ? 'NDVI curve available' : 'No NDVI curve'}</p>
          <p>{`Years ${years[0]}-${years[years.length - 1]}`}</p>
          <button type="button" onClick={props.onClose}>
            Close
          </button>
          <button type="button" onClick={() => props.onSelectYear?.(2020)}>
            Show 2020
          </button>
        </section>
      )
    },
  }
})

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

/** Holds back the point panel's responses until the returned function is called. */
function holdPanelResponses() {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  // Answering nothing passes the request on to the default handlers.
  const wait = async () => {
    await held
  }
  server.use(http.get('*/phenology/point', wait), http.get('*/phenology/timeseries', wait))
  return release
}

/**
 * Fails the first request for the grid of `year`, then holds the next one back until the
 * returned function is called. Other years load as usual.
 */
function failGridThenHold(year: number) {
  let failed = false
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  server.use(
    http.get('*/phenology/grid', async ({ request }) => {
      if (Number(new URL(request.url).searchParams.get('year')) !== year) return
      if (!failed) {
        failed = true
        return HttpResponse.text('Internal Server Error', { status: 500 })
      }
      await held
    }),
  )
  return release
}

/** Makes the browser say that focus did not come from the keyboard, as after a mouse click. */
function focusNotVisible() {
  const matches = Element.prototype.matches
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector) {
    return selector === ':focus-visible' ? false : matches.call(this, selector)
  })
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

/**
 * Where a copy of a message is displayed: 'lg up' (on the map), 'below lg' (by the Year slider)
 * or 'always'. jsdom loads no CSS, so this reads the Tailwind classes.
 */
function shownAt(element: HTMLElement) {
  if (element.closest('.lg\\:hidden')) return 'below lg'
  if (element.closest('.hidden.lg\\:block')) return 'lg up'
  return 'always'
}

/** A ResizeObserver whose callbacks the test runs. */
class FakeResizeObserver {
  static observers: FakeResizeObserver[] = []
  callback: ResizeObserverCallback
  targets = new Set<Element>()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.observers.push(this)
  }
  observe(target: Element) {
    this.targets.add(target)
  }
  unobserve(target: Element) {
    this.targets.delete(target)
  }
  disconnect() {
    this.targets.clear()
  }

  /** Gives `element` a new height and tells the observers watching it. */
  static resize(element: HTMLElement, height: number) {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ height } as DOMRect)
    for (const observer of FakeResizeObserver.observers) {
      if (observer.targets.has(element)) observer.callback([], observer as ResizeObserver)
    }
  }
}

// jsdom does not implement scrolling.
const scrollIntoView = vi.fn()
beforeEach(() => {
  shownMap.props = null
  FakeResizeObserver.observers = []
  Element.prototype.scrollIntoView = scrollIntoView
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
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
    // The first load is shown on the map at every size.
    expect(shownAt(await screen.findByText('Loading the grid for 2026…'))).toBe('always')
    await waitForMap('Map of season length in 2026')
    expect(screen.queryByText('Loading the grid for 2026…')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Previous year' }))

    // On the map from lg up, and under the Year slider below lg, where the map may be out of view.
    const notes = await screen.findAllByText('Loading 2025…')
    expect(notes.map(shownAt)).toEqual(['lg up', 'below lg'])
    expect(screen.getByRole('group', { name: 'Map of season length in 2026' })).toBeVisible()
    // Below lg the map itself says which year it still shows, for the eye only.
    const chip = screen.getByText('Showing 2026 (loading 2025)')
    expect(shownAt(chip)).toBe('below lg')
    expect(chip).toHaveAttribute('aria-hidden', 'true')
    await waitForMap('Map of season length in 2025')
    expect(screen.queryAllByText('Loading 2025…')).toHaveLength(0)
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument()
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
    // With no grid on the map yet, the message sits on the map at every size.
    expect(shownAt(alert)).toBe('always')
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
    // Seasons a month longer in 2025, so a scale fitted to each year's values would move.
    server.use(
      http.get('*/phenology/grid', ({ request }) => {
        const year = Number(new URL(request.url).searchParams.get('year'))
        const grid = gridFor(year)
        if (year === 2025) {
          for (const { properties } of grid.features) {
            properties.season_length = (properties.season_length ?? 0) + 30
          }
        }
        return HttpResponse.json(grid)
      }),
    )
    const { user } = renderPage()
    await waitForMap('Map of season length in 2026')
    const fill2026 = shownMap.props?.fillColor

    await user.click(screen.getByRole('button', { name: 'Previous year' }))
    await waitForMap('Map of season length in 2025')

    expect(shownMap.props?.fillColor).toEqual(fill2026)
    // The palette runs over the metric's fixed range: [case, test, [interpolate, kind, input,
    // value, colour, ...], no data].
    const ramp = (shownMap.props?.fillColor[2] as unknown[]).slice(3)
    const values = ramp.filter((_, i) => i % 2 === 0)
    expect([values[0], values[values.length - 1]]).toEqual(COLOUR_DOMAINS.season_length)
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

    // On the map from lg up, and under the Year slider below lg, where the map may be out of view.
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map(shownAt)).toEqual(['lg up', 'below lg'])
    const alert = alerts[1]
    expect(alert).toHaveTextContent('Could not load the grid for 2025')
    expect(alert).toHaveTextContent('The map still shows 2026.')
    const chip = screen.getByText('Showing 2026 (2025 failed)')
    expect(shownAt(chip)).toBe('below lg')
    expect(chip).toHaveAttribute('aria-hidden', 'true')
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
    const slider = screen.getByRole('slider', { name: 'Year' })
    const focusSlider = vi.spyOn(slider, 'focus')

    await waitForMap('Map of season length in 2025')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Selected point' })).toBeInTheDocument()
    // The focused button went with the message: focus moves to the Year slider, just above it.
    expect(slider).toHaveFocus()
    expect(focusSlider).toHaveBeenCalledWith({ preventScroll: true })
  })

  it.each([
    { copy: 'below lg', media: [], route: '/?year=2026', next: 'slider' },
    { copy: 'lg up', media: ['(min-width: 64rem)'], route: '/?year=2026', next: 'map' },
    // With no grid loaded yet, the message is on the map at every size.
    { copy: 'always', media: [], route: '/', next: 'map' },
  ] as const)(
    'after a Try again by keyboard in the $copy copy succeeds, focuses the $next, in view',
    async ({ copy, media, route, next }) => {
      matchMedia(...media)
      const release = failGridThenHold(route === '/' ? 2026 : 2025)
      const { user } = renderPage(route)
      if (route !== '/') {
        await waitForMap('Map of season length in 2026')
        await user.click(screen.getByRole('button', { name: 'Previous year' }))
      }
      const alert = (await screen.findAllByRole('alert')).find((a) => shownAt(a) === copy)
      const retry = within(alert!).getByRole('button', { name: 'Try again' })
      act(() => retry.focus())
      await user.keyboard('{Enter}')
      expect(retry).toHaveAccessibleName('Trying again…')
      const target =
        next === 'map'
          ? screen.getByRole('group', { name: /^Map of/ })
          : screen.getByRole('slider', { name: 'Year' })
      const focusTarget = vi.spyOn(target, 'focus')

      release()
      await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0))

      expect(target).toHaveFocus()
      expect(focusTarget).toHaveBeenCalledWith({ preventScroll: true })
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
      expect(scrollIntoView.mock.contexts[0]).toBe(target)
    },
  )

  it('after a mouse click on Try again on the map, focuses the map without scrolling', async () => {
    matchMedia('(min-width: 64rem)')
    focusNotVisible()
    const release = failGridThenHold(2025)
    const { user } = renderPage('/?lat=51.5&lon=-0.5')
    await waitForMap('Map of season length in 2026')
    await user.click(screen.getByRole('button', { name: 'Previous year' }))
    const onMap = (await screen.findAllByRole('alert')).find((a) => shownAt(a) === 'lg up')
    const slider = screen.getByRole('slider', { name: 'Year' })
    const focusSlider = vi.spyOn(slider, 'focus')
    const map = screen.getByRole('group', { name: 'Map of season length in 2026' })
    const focusMap = vi.spyOn(map, 'focus')

    await user.click(within(onMap!).getByRole('button', { name: 'Try again' }))
    release()
    await waitForMap('Map of season length in 2025')

    // Not the Year slider, whose column the user may have scrolled meanwhile.
    expect(map).toHaveFocus()
    expect(focusMap).toHaveBeenCalledWith({ preventScroll: true })
    expect(focusSlider).not.toHaveBeenCalled()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('moves focus after a successful retry if focus left the message for the page', async () => {
    const release = failGridThenHold(2025)
    const { user } = renderPage()
    await waitForMap('Map of season length in 2026')
    await user.click(screen.getByRole('button', { name: 'Previous year' }))
    const alert = (await screen.findAllByRole('alert'))[1]
    const retry = within(alert).getByRole('button', { name: 'Try again' })
    await user.click(retry)
    // As when the user clicks somewhere that takes no focus.
    act(() => retry.blur())
    expect(document.body).toHaveFocus()

    release()
    await waitForMap('Map of season length in 2025')

    expect(screen.getByRole('slider', { name: 'Year' })).toHaveFocus()
  })

  it('leaves focus on a control the user moved to before the retry succeeded', async () => {
    const release = failGridThenHold(2025)
    const { user } = renderPage()
    await waitForMap('Map of season length in 2026')
    await user.click(screen.getByRole('button', { name: 'Previous year' }))
    const alert = (await screen.findAllByRole('alert'))[1]
    const retry = within(alert).getByRole('button', { name: 'Try again' })
    await user.click(retry)
    // Focus goes to the page first, then on into the search form.
    act(() => retry.blur())
    const latitude = screen.getByLabelText('Latitude')
    act(() => latitude.focus())

    release()
    await waitForMap('Map of season length in 2025')

    expect(latitude).toHaveFocus()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('below lg, shows a year change under the Year slider before any grid has loaded', async () => {
    server.use(
      http.get('*/phenology/grid', async ({ request }) => {
        if (new URL(request.url).searchParams.get('year') === '2025') await delay(30)
        return HttpResponse.text('Internal Server Error', { status: 500 })
      }),
    )
    const { user } = renderPage()
    // The first load's failure stays on the map, at the top of the page, at every size.
    const first = await screen.findByRole('alert')
    expect(first).toHaveTextContent('Could not load the grid for 2026')
    expect(shownAt(first)).toBe('always')

    await user.click(screen.getByRole('button', { name: 'Previous year' }))

    // A change made from the controls is shown by them below lg, and on the map from lg up.
    const loading = await screen.findAllByText(/^Loading (the grid for )?2025…$/)
    expect(loading.map(shownAt)).toEqual(['lg up', 'below lg'])
    expect(screen.getAllByRole('status').filter((s) => /2025/.test(s.textContent ?? ''))).toEqual(
      loading.map((note) => note.closest('[role="status"]')),
    )
    await waitFor(() => expect(screen.queryAllByText(/^Loading/)).toHaveLength(0))
    const alerts = screen.getAllByRole('alert')
    expect(alerts.map(shownAt)).toEqual(['lg up', 'below lg'])
    expect(alerts[1]).toHaveTextContent('Could not load the grid for 2025')
    // No grid is on the map, so there is no other year to point out on it.
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument()
  })

  it('leaves focus where it is when the failure goes because the year changed', async () => {
    server.use(
      http.get('*/phenology/grid', ({ request }) => {
        const year = Number(new URL(request.url).searchParams.get('year'))
        if (year === 2025) return HttpResponse.text('Internal Server Error', { status: 500 })
        return HttpResponse.json(gridFor(year))
      }),
    )
    const { user } = renderPage()
    await waitForMap('Map of season length in 2026')
    const previous = screen.getByRole('button', { name: 'Previous year' })
    await user.click(previous)
    const alert = (await screen.findAllByRole('alert'))[1]
    // Focus visits the message, then goes back to the year buttons.
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    const next = screen.getByRole('button', { name: 'Next year' })
    await user.click(next)

    await waitFor(() => expect(screen.queryAllByRole('alert')).toHaveLength(0))
    expect(next).toHaveFocus()
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

  it('below lg, reveals the panel at once for a tap on the selected cell however the URL spells it', async () => {
    const { user, search } = renderPage('/?lat=51.50&lon=-0.50')
    await waitForMap('Map of season length in 2026')
    const panel = await screen.findByRole('region', { name: 'Selected point' })

    await user.click(screen.getByRole('button', { name: 'Cell 51.5, -0.5' }))

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toContainElement(panel)
    expect(search().get('lat')).toBe('51.50')

    // Nothing is left pending to scroll and take focus when the selection next changes.
    const previous = screen.getByRole('button', { name: 'Previous year' })
    await user.click(previous)
    await waitForMap('Map of season length in 2025')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(previous).toHaveFocus()
  })

  /** Selects a cell below lg with its panel's data held back, and returns the revealed panel. */
  async function revealWithDataHeldBack() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    matchMedia('(prefers-reduced-motion: reduce)')
    const release = holdPanelResponses()
    const page = renderPage()
    await waitForMap('Map of season length in 2026')
    await page.user.click(screen.getByRole('button', { name: 'Cell 51.5, -0.5' }))
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    const panel = scrollIntoView.mock.contexts[0] as HTMLElement
    return { ...page, panel, release }
  }

  it('below lg, keeps the panel revealed as it grows until its data is in', async () => {
    const { panel, release, queryClient } = await revealWithDataHeldBack()

    // The page grows with the panel, so the panel's top can now reach the top of the screen.
    FakeResizeObserver.resize(panel, 400)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    expect(scrollIntoView.mock.contexts[1]).toBe(panel)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'start', behavior: 'auto' })
    FakeResizeObserver.resize(panel, 300)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)

    // However long the data takes.
    vi.advanceTimersByTime(5000)
    FakeResizeObserver.resize(panel, 600)
    expect(scrollIntoView).toHaveBeenCalledTimes(3)

    // Once it is in, the panel is followed while it draws it, and then left alone.
    release()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    FakeResizeObserver.resize(panel, 700)
    expect(scrollIntoView).toHaveBeenCalledTimes(4)
    vi.advanceTimersByTime(500)
    FakeResizeObserver.resize(panel, 900)
    expect(scrollIntoView).toHaveBeenCalledTimes(4)
  })

  it('below lg, stops following the panel after 15 s if its data never comes', async () => {
    const { panel, release, queryClient } = await revealWithDataHeldBack()

    vi.advanceTimersByTime(14_000)
    FakeResizeObserver.resize(panel, 400)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1_000)
    FakeResizeObserver.resize(panel, 800)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    // Requests left in flight would fail the next test's requests.
    release()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  })

  it.each(['wheel', 'touchstart', 'pointerdown', 'keydown'])(
    'below lg, stops following the panel on a %s, when the user takes over',
    async (type) => {
      const { panel, release, queryClient } = await revealWithDataHeldBack()
      FakeResizeObserver.resize(panel, 400)
      expect(scrollIntoView).toHaveBeenCalledTimes(2)

      act(() => {
        window.dispatchEvent(new Event(type))
      })
      FakeResizeObserver.resize(panel, 800)
      expect(scrollIntoView).toHaveBeenCalledTimes(2)
      release()
      await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    },
  )

  it('below lg, follows only the latest selection, and nothing once the page goes', async () => {
    const { panel, release, user, unmount } = await revealWithDataHeldBack()
    const watching = () => FakeResizeObserver.observers.filter((o) => o.targets.has(panel))

    await user.click(screen.getByRole('button', { name: 'Cell 51.6, -0.4' }))
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2))
    expect(watching()).toHaveLength(1)
    FakeResizeObserver.resize(panel, 400)
    expect(scrollIntoView).toHaveBeenCalledTimes(3)

    unmount()
    expect(watching()).toHaveLength(0)
    release()
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
