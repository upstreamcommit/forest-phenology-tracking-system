import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { YearMetric } from '../../api/types'
import { timeseriesFor } from '../../test/fixtures'
import { TrendChart } from './TrendChart'

// The fixture point (51.5, -0.5): 2021 starts late and 2022 ends early.
const METRICS = timeseriesFor(51.5, -0.5, 2016, 2026).metrics
const YEAR_LABEL = /^\d{4}:/

function yearBar(year: number) {
  return screen.getByRole('button', { name: new RegExp(`^${year}:`) })
}

describe('TrendChart', () => {
  it('draws one labelled bar per year inside a named figure', () => {
    const { container } = render(
      <TrendChart metrics={METRICS} title="Season timing" onSelectYear={() => {}} />,
    )
    expect(screen.getByRole('figure', { name: 'Season timing' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: YEAR_LABEL })).toHaveLength(11)
    expect(container.querySelectorAll('svg rect[data-year]')).toHaveLength(11)
    expect(yearBar(2021)).toHaveAccessibleName(
      '2021: start 11 Apr 2021, end 20 Oct 2021, season 192 days',
    )
  })

  it('uses focusable images, not buttons, when years cannot be selected', () => {
    render(<TrendChart metrics={METRICS} title="Season timing" />)
    expect(screen.queryAllByRole('button', { name: YEAR_LABEL })).toHaveLength(0)
    const bars = screen.getAllByRole('img', { name: YEAR_LABEL })
    expect(bars).toHaveLength(11)
    for (const bar of bars) expect(bar).toHaveAttribute('tabindex', '0')
  })

  it('highlights the given year and only that year', () => {
    const { container } = render(
      <TrendChart
        metrics={METRICS}
        title="Season timing"
        highlightYear={2022}
        onSelectYear={() => {}}
      />,
    )
    expect(yearBar(2022)).toHaveAttribute('aria-current', 'true')
    expect(yearBar(2021)).not.toHaveAttribute('aria-current')
    const accentBars = container.querySelectorAll('svg rect.fill-accent')
    expect(accentBars).toHaveLength(1)
    expect(accentBars[0]).toHaveAttribute('data-year', '2022')
  })

  it('draws the average start and end as reference lines', () => {
    const { container } = render(<TrendChart metrics={METRICS} title="Season timing" />)
    expect(container.querySelector('line[data-average="sos"]')).toBeInTheDocument()
    expect(container.querySelector('line[data-average="eos"]')).toBeInTheDocument()
  })

  it('shows a tooltip with the dates and length on focus, and hides it on Escape or blur', async () => {
    const user = userEvent.setup()
    render(<TrendChart metrics={METRICS} title="Season timing" onSelectYear={() => {}} />)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await user.tab()
    expect(yearBar(2016)).toHaveFocus()
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('2016')
    expect(tooltip).toHaveTextContent('Start4 Apr 2016')
    expect(tooltip).toHaveTextContent('End19 Oct 2016')
    expect(tooltip).toHaveTextContent('Length198 days')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await user.tab()
    expect(screen.getByRole('tooltip')).toHaveTextContent('2017')
    await user.tab({ shift: true })
    await user.tab({ shift: true })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows a tooltip on hover', async () => {
    const user = userEvent.setup()
    render(<TrendChart metrics={METRICS} title="Season timing" />)
    await user.hover(screen.getByRole('img', { name: /^2022:/ }))
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Start3 Apr 2022End4 Oct 2022Length184 days',
    )
    await user.unhover(screen.getByRole('img', { name: /^2022:/ }))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('selects a year by click, Enter and Space', async () => {
    const user = userEvent.setup()
    const onSelectYear = vi.fn()
    render(<TrendChart metrics={METRICS} title="Season timing" onSelectYear={onSelectYear} />)

    await user.click(yearBar(2021))
    expect(onSelectYear).toHaveBeenLastCalledWith(2021)

    act(() => yearBar(2019).focus())
    await user.keyboard('{Enter}')
    expect(onSelectYear).toHaveBeenLastCalledWith(2019)

    act(() => yearBar(2024).focus())
    await user.keyboard(' ')
    expect(onSelectYear).toHaveBeenLastCalledWith(2024)
    expect(onSelectYear).toHaveBeenCalledTimes(3)
  })

  it('reveals a data table with a row per year and the average', async () => {
    const user = userEvent.setup()
    render(<TrendChart metrics={METRICS} title="Season timing" highlightYear={2022} />)
    const toggle = screen.getByRole('button', { name: 'Show data table' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAccessibleName('Hide data table')
    const table = screen.getByRole('table', { name: 'Season timing, by year' })
    // Header, 11 years and the average.
    expect(within(table).getAllByRole('row')).toHaveLength(13)

    const row2022 = within(table).getByRole('row', { name: /^2022/ })
    expect(within(row2022).getByRole('rowheader')).toHaveTextContent('2022 (selected)')
    expect(within(row2022).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      '3 Apr 2022',
      '4 Oct 2022',
      '184 days',
    ])

    const average = within(table).getByRole('row', { name: /^Average/ })
    expect(within(average).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      '4 Apr',
      '19 Oct',
      '198 days',
    ])

    await user.click(toggle)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('marks years with missing dates instead of drawing a bar', async () => {
    const user = userEvent.setup()
    const metrics: YearMetric[] = METRICS.map((m) =>
      m.year === 2019
        ? { year: 2019, is_forest: true, sos_date: null, eos_date: null, season_length: null }
        : m.year === 2020
          ? { ...m, eos_date: null, season_length: null }
          : m,
    )
    const { container } = render(
      <TrendChart metrics={metrics} title="Season timing" onSelectYear={() => {}} />,
    )

    expect(container.querySelector('rect[data-year="2019"]')).not.toBeInTheDocument()
    expect(container.querySelector('circle[data-year="2019"][data-missing]')).toBeInTheDocument()
    expect(container.querySelector('circle[data-year="2020"][data-missing]')).toBeInTheDocument()
    expect(yearBar(2019)).toHaveAccessibleName('2019: no data')
    expect(yearBar(2020)).toHaveAccessibleName('2020: start 3 Apr 2020, end no data')

    act(() => yearBar(2019).focus())
    expect(screen.getByRole('tooltip')).toHaveTextContent('No data for this year')

    await user.click(screen.getByRole('button', { name: 'Show data table' }))
    const row = screen.getByRole('row', { name: /^2019/ })
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'No data',
      'No data',
      'No data',
    ])
  })

  it('renders without bars when no year has dates', () => {
    const metrics: YearMetric[] = [2016, 2017].map((year) => ({ year, is_forest: false }))
    const { container } = render(<TrendChart metrics={metrics} title="Season timing" />)
    expect(container.querySelectorAll('circle[data-missing]')).toHaveLength(2)
    expect(container.querySelector('line[data-average]')).not.toBeInTheDocument()
  })
})
