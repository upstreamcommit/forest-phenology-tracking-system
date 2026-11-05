import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { PRODUCT, YEARS } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import { PointPanel, type PointPanelProps } from './PointPanel'

// A forest grid point inside the fixture grid. In 2022 its season ends early.
const BASE: PointPanelProps = {
  product: PRODUCT,
  year: 2022,
  years: YEARS,
  lat: 51.5,
  lon: -0.5,
  inComputedArea: false,
  onClose: () => {},
}

function renderPanel(props: Partial<PointPanelProps> = {}) {
  return renderWithProviders(<PointPanel {...BASE} {...props} />)
}

/** The stat tile with this label (a dt and its dd values). */
function stat(label: string) {
  return screen.getByText(label, { selector: 'dt' }).parentElement!
}

describe('PointPanel', () => {
  it('shows a loading state, then the point in a named region', async () => {
    renderPanel()
    expect(screen.getByRole('status')).toHaveTextContent('Loading point metrics')

    const region = await screen.findByRole('region', { name: 'Selected point 51.50° N, 0.50° W' })
    expect(within(region).getByRole('heading', { level: 2 })).toHaveTextContent(
      '51.50° N, 0.50° W',
    )
    expect(await screen.findByRole('heading', { name: '2022 season' })).toBeInTheDocument()
    expect(screen.queryByText('Loading point metrics')).not.toBeInTheDocument()
  })

  it('shows the stored dates, length and land cover for the year', async () => {
    renderPanel()
    await screen.findByRole('heading', { name: '2022 season' })

    expect(stat('Start of season')).toHaveTextContent('3 Apr 2022day 93')
    expect(stat('End of season')).toHaveTextContent('4 Oct 2022day 277')
    expect(stat('Season length')).toHaveTextContent('184 days')
    expect(stat('Land cover')).toHaveTextContent('Forest')
  })

  it('labels a non-forest point as open land', async () => {
    renderPanel({ lat: 51.6 })
    await screen.findByRole('heading', { name: '2022 season' })
    expect(stat('Land cover')).toHaveTextContent('Open land')
  })

  it("compares the year with the point's average across the years", async () => {
    renderPanel()
    expect(
      await screen.findByText("Season 14 days shorter than this point's 2016–2026 average"),
    ).toBeInTheDocument()
    expect(screen.getByText('Started 1 day earlier than average')).toBeInTheDocument()
    expect(screen.getByText('Ended 15 days earlier than average')).toBeInTheDocument()
  })

  it('compares a late-starting year the other way round', async () => {
    renderPanel({ year: 2021 })
    expect(
      await screen.findByText("Season 6 days shorter than this point's 2016–2026 average"),
    ).toBeInTheDocument()
    expect(screen.getByText('Started 7 days later than average')).toBeInTheDocument()
    expect(screen.getByText('Ended 1 day later than average')).toBeInTheDocument()
  })

  it('charts every year with the selected year highlighted', async () => {
    renderPanel({ onSelectYear: () => {} })
    const chart = await screen.findByRole('figure', { name: 'Season timing, 2016–2026' })
    expect(within(chart).getAllByRole('button', { name: /^\d{4}:/ })).toHaveLength(YEARS.length)
    expect(within(chart).getByRole('button', { name: /^2022:/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('calls onSelectYear when a year is picked in the chart', async () => {
    const user = userEvent.setup()
    const onSelectYear = vi.fn()
    renderPanel({ onSelectYear })
    await user.click(await screen.findByRole('button', { name: /^2019:/ }))
    expect(onSelectYear).toHaveBeenCalledWith(2019)
  })

  it('calls onClose from the close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderPanel({ onClose })
    await user.click(screen.getByRole('button', { name: 'Close point details' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows an empty state when the point has no stored metrics for the year', async () => {
    server.use(
      http.get('*/phenology/point', () =>
        HttpResponse.json({ detail: 'No phenology data found' }, { status: 404 }),
      ),
      http.get('*/phenology/timeseries', () =>
        HttpResponse.json({ detail: 'No phenology data found' }, { status: 404 }),
      ),
    )
    renderPanel()
    expect(await screen.findByText('No stored metrics for this point in 2022.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a server error and recovers on retry', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/phenology/point', () => new HttpResponse('Internal Server Error', { status: 500 })),
    )
    renderPanel()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load this point')
    expect(alert).toHaveTextContent('The API had an internal problem. Try again in a moment.')

    server.resetHandlers()
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: '2022 season' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a timeseries error without hiding the year', async () => {
    server.use(
      http.get('*/phenology/timeseries', () =>
        new HttpResponse('Internal Server Error', { status: 500 }),
      ),
    )
    renderPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the season record')
    expect(stat('Start of season')).toHaveTextContent('3 Apr 2022')
    expect(screen.queryByText(/than average/)).not.toBeInTheDocument()
  })

  it('mentions the computed NDVI curve only inside the computed area', async () => {
    const { unmount } = renderPanel({ inComputedArea: true })
    expect(
      screen.getByText('A computed NDVI curve is available for this point.'),
    ).toBeInTheDocument()
    unmount()

    renderPanel({ inComputedArea: false })
    await screen.findByRole('heading', { name: '2022 season' })
    expect(
      screen.queryByText('A computed NDVI curve is available for this point.'),
    ).not.toBeInTheDocument()
  })

  it('renders the actions slot', () => {
    renderPanel({ actions: <a href="/points/51.5/-0.5">Open point details</a> })
    expect(screen.getByRole('link', { name: 'Open point details' })).toBeInTheDocument()
  })
})
