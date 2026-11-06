import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { YearMetric } from '../../api/types'
import { dateFromDayOfYear } from '../../lib/dates'
import { timeseriesFor } from '../../test/fixtures'
import { TrendChart } from './TrendChart'

// The fixture point (51.5, -0.5): 2021 starts late and 2022 ends early.
const METRICS = timeseriesFor(51.5, -0.5, 2016, 2026).metrics
const YEAR_LABEL = /^\d{4}:/

function yearBar(year: number) {
  return screen.getByRole('button', { name: new RegExp(`^${year}:`) })
}

function averageRow() {
  const table = screen.getByRole('table', { hidden: true })
  const row = within(table).getByRole('row', { name: /^Average/, hidden: true })
  return within(row)
    .getAllByRole('cell', { hidden: true })
    .map((cell) => cell.textContent)
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

/** A year's hit area, from its inline style, in the chart's own pixels. */
function hitArea(element: HTMLElement): Box {
  const [left, top, width, height] = ['left', 'top', 'width', 'height'].map((side) =>
    parseFloat(element.style.getPropertyValue(side)),
  )
  return { left, right: left + width, top, bottom: top + height }
}

/**
 * Where the tooltip lies, from its inline style, if it is `width` by `height` pixels: jsdom has no
 * layout, and the real size depends on the font.
 */
function tooltipBox(tooltip: HTMLElement, width: number, height: number): Box {
  const { left, top, bottom, maxWidth, transform } = tooltip.style
  const chartHeight = parseFloat(tooltip.parentElement!.style.height)
  const shift = Number(/^translateX\((-?[\d.]+)%\)$/.exec(transform)?.[1])
  const w = Math.min(width, parseFloat(maxWidth))
  const x = parseFloat(left) + (shift / 100) * w
  const topEdge = top ? parseFloat(top) : chartHeight - parseFloat(bottom) - height
  return { left: x, right: x + w, top: topEdge, bottom: topEdge + height }
}

/** Which band the tooltip is in, from its inline style. */
function tooltipSide(tooltip: HTMLElement) {
  const { top, bottom } = tooltip.style
  if (top && !bottom) return 'below'
  if (bottom && !top) return 'above'
  throw new Error(`Tooltip at top ${top}, bottom ${bottom}`)
}

/**
 * Lays the chart out in jsdom: every element is `width` wide, the plot (the box that holds the
 * hit areas) has its top at `plot.top`, and a scroller with overflow-y auto shows `scroller`.
 */
function mockLayout(width: number, plot: { top: number }, scroller = { top: 0, height: 0 }) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.style.overflowY === 'auto') return new DOMRect(0, scroller.top, width, scroller.height)
    if (this.style.marginTop) return new DOMRect(0, plot.top, width, 180)
    return new DOMRect(0, 0, width, 0)
  })
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/** The vertical position of a month's label on the axis. */
function monthLabelY(container: HTMLElement, month: string) {
  const label = [...container.querySelectorAll('svg text')].find((t) => t.textContent === month)
  return label?.getAttribute('y')
}

describe('TrendChart', () => {
  // 304px is the chart in the map page's 24rem column when a classic scrollbar takes 15px of it.
  it.each([304, 320])('gives each of 11 years a target at least 24px wide, %ipx wide', (width) => {
    mockLayout(width, { top: 0 })
    render(<TrendChart metrics={METRICS} title="Season timing" onSelectYear={() => {}} />)
    const widths = screen
      .getAllByRole('button', { name: YEAR_LABEL })
      .map((bar) => hitArea(bar).right - hitArea(bar).left)
    expect(widths).toHaveLength(11)
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(24)
  })

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

  it('marks the highlighted year with a column background and a bold year label', () => {
    const { container } = render(
      <TrendChart metrics={METRICS} title="Season timing" highlightYear={2022} />,
    )
    const columns = container.querySelectorAll('svg rect.fill-accent-soft')
    expect(columns).toHaveLength(1)
    const bar = container.querySelector('svg rect[data-year="2022"]')!
    const centre = (rect: Element) =>
      Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2
    expect(centre(columns[0])).toBeCloseTo(centre(bar), 6)

    const bold = container.querySelectorAll('svg text.font-semibold')
    expect(bold).toHaveLength(1)
    expect(bold[0]).toHaveTextContent('2022')
  })

  it('keeps the highlighted year labelled when a narrow chart thins the year labels', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 200, 180),
    )
    const { container } = render(
      <TrendChart metrics={METRICS} title="Season timing" highlightYear={2017} />,
    )
    const labels = [...container.querySelectorAll('svg text')].map((t) => t.textContent)
    // Every other year is labelled, in short form; 2017 would be skipped but is highlighted.
    expect(labels).toEqual(expect.arrayContaining(['’16', '’17', '’18', '’26']))
    expect(labels).not.toContain('’19')
    const bold = container.querySelectorAll('svg text.font-semibold')
    expect(bold).toHaveLength(1)
    expect(bold[0]).toHaveTextContent('’17')
    expect(container.querySelectorAll('svg rect.fill-accent-soft')).toHaveLength(1)
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
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^2016 4 Apr – 19 Oct · 198 days$/)

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
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^2022 3 Apr – 4 Oct · 184 days$/)
    await user.unhover(screen.getByRole('img', { name: /^2022:/ }))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('closes a tooltip opened by hover alone on Escape, with focus elsewhere', async () => {
    const user = userEvent.setup()
    render(<TrendChart metrics={METRICS} title="Season timing" />)
    await user.hover(screen.getByRole('img', { name: /^2022:/ }))
    expect(document.activeElement).toBe(document.body)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('keeps the tooltip open while the pointer moves onto it (WCAG 1.4.13)', async () => {
    const user = userEvent.setup()
    render(<TrendChart metrics={METRICS} title="Season timing" />)
    const bar = screen.getByRole('img', { name: /^2022:/ })
    await user.hover(bar)
    const tooltip = screen.getByRole('tooltip')

    // Moving onto the tooltip keeps the year it describes.
    fireEvent.mouseOut(bar, { relatedTarget: tooltip })
    expect(screen.getByRole('tooltip')).toBe(tooltip)
    expect(tooltip).toHaveTextContent('2022')

    // Leaving it for another year shows that year; leaving the chart hides it.
    fireEvent.mouseOut(tooltip, { relatedTarget: screen.getByRole('img', { name: /^2021:/ }) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('2021')
    fireEvent.mouseOut(screen.getByRole('img', { name: /^2021:/ }), {
      relatedTarget: document.body,
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  // With the plot's top 100px down the viewport the band above it shows; at 0 it is off screen.
  it.each([
    [200, 'above', 100],
    [320, 'above', 100],
    [640, 'above', 100],
    [200, 'below', 0],
    [320, 'below', 0],
    [640, 'below', 0],
  ] as const)(
    'puts the tooltip in line with its bar, clear of every other year, %ipx wide, %s the plot',
    (width, side, plotTop) => {
      mockLayout(width, { top: plotTop })
      const { container } = render(
        <TrendChart metrics={METRICS} title="Season timing" onSelectYear={() => {}} />,
      )
      const bars = screen.getAllByRole('button', { name: YEAR_LABEL })
      const areas = bars.map(hitArea)
      expect(areas.flatMap((a) => Object.values(a)).every(Number.isFinite)).toBe(true)
      const plot = bars[0].parentElement!
      expect(container.contains(plot)).toBe(true)
      const band = {
        above: parseFloat(plot.style.marginTop),
        below: parseFloat(plot.style.marginBottom),
      }

      for (const [index, bar] of bars.entries()) {
        act(() => bar.focus())
        const tooltip = screen.getByRole('tooltip')
        expect(tooltipSide(tooltip)).toBe(side)
        const own = areas[index]
        const centre = (own.left + own.right) / 2
        // One line in a wide chart; wrapped onto three, as wide as the chart, in a narrow one.
        for (const [w, h] of [
          [120, 26],
          [width, 58],
        ]) {
          const box = tooltipBox(tooltip, w, h)
          expect(Object.values(box).every(Number.isFinite)).toBe(true)
          // Inside the chart, to a hundredth of a pixel (jsdom shortens the numbers in a style).
          expect(box.left).toBeGreaterThan(-0.01)
          expect(box.right).toBeLessThan(width + 0.01)
          // Straight up (or down) from the bar, with no gap to cross on the way.
          expect(box.left).toBeLessThan(centre)
          expect(box.right).toBeGreaterThan(centre)
          if (side === 'above') expect(box.bottom).toBe(own.top)
          else expect(box.top).toBe(own.bottom)
          areas.forEach((area, other) => {
            if (other !== index) expect(overlaps(box, area), `${2016 + other}`).toBe(false)
          })
          // A one-line tooltip fits the room kept for it, so it covers nothing around the plot.
          if (h === 26) {
            if (side === 'above') expect(box.top).toBeGreaterThanOrEqual(-band.above)
            else expect(box.bottom).toBeLessThanOrEqual(180 + band.below)
          }
        }
      }
    },
  )

  it('moves the tooltip below the plot while a scroll container hides the band above', async () => {
    const user = userEvent.setup()
    // The scroller shows 100 to 600px down the viewport.
    const plot = { top: 300 }
    mockLayout(400, plot, { top: 100, height: 500 })
    render(
      <div data-testid="scroller" style={{ overflowY: 'auto' }}>
        <TrendChart metrics={METRICS} title="Season timing" />
      </div>,
    )
    const scroller = screen.getByTestId('scroller')
    Object.defineProperty(scroller, 'clientHeight', { value: 500 })
    const scroll = (top: number) => {
      plot.top = top
      fireEvent.scroll(scroller)
    }

    await user.hover(screen.getByRole('img', { name: /^2020:/ }))
    expect(tooltipSide(screen.getByRole('tooltip'))).toBe('above')
    // The band above is 28px: 110 leaves 10px of it in view, 128 all of it.
    scroll(110)
    expect(tooltipSide(screen.getByRole('tooltip'))).toBe('below')
    scroll(128)
    expect(tooltipSide(screen.getByRole('tooltip'))).toBe('above')
    // Scrolled up past the scroller's top, the plot shows only its lower part.
    scroll(-50)
    expect(tooltipSide(screen.getByRole('tooltip'))).toBe('below')
    await user.unhover(screen.getByRole('img', { name: /^2020:/ }))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    // Placed when it opens, on focus too, and still closed by Escape.
    plot.top = 300
    act(() => screen.getByRole('img', { name: /^2021:/ }).focus())
    expect(tooltipSide(screen.getByRole('tooltip'))).toBe('above')
    act(() => screen.getByRole('img', { name: /^2021:/ }).blur())
    plot.top = 90
    act(() => screen.getByRole('img', { name: /^2022:/ }).focus())
    expect(tooltipSide(screen.getByRole('tooltip'))).toBe('below')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^2022:/ })).toHaveFocus()
  })

  it('stops following scrolls once the tooltip closes', () => {
    const plot = { top: 300 }
    mockLayout(400, plot)
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    render(<TrendChart metrics={METRICS} title="Season timing" />)
    const bar = screen.getByRole('img', { name: /^2020:/ })
    expect(add).not.toHaveBeenCalledWith('scroll', expect.anything(), expect.anything())

    act(() => bar.focus())
    const [, listener] = add.mock.calls.find(([type]) => type === 'scroll')!
    act(() => bar.blur())
    const capturing = expect.objectContaining({ capture: true })
    expect(remove).toHaveBeenCalledWith('scroll', listener, capturing)
  })

  it("gives a date the year when it falls outside the bar's year", () => {
    const metrics: YearMetric[] = [
      ...METRICS.filter((m) => m.year !== 2017),
      {
        year: 2017,
        is_forest: true,
        sos_date: '2017-04-03',
        eos_date: '2018-01-15',
        season_length: 287,
      },
    ]
    render(<TrendChart metrics={metrics} title="Season timing" onSelectYear={() => {}} />)
    const tooltip = () => screen.getByRole('tooltip')
    act(() => yearBar(2017).focus())
    expect(tooltip()).toHaveTextContent(/^2017 3 Apr – 15 Jan 2018 · 287 days$/)
    // Dates in the bar's own year still leave it out.
    act(() => yearBar(2018).focus())
    expect(tooltip()).toHaveTextContent(/^2018 \d+ [A-Z][a-z]{2} – \d+ [A-Z][a-z]{2} · \d+ days$/)
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

  it('shows the same average dates and month lines whether or not the year is a leap year', () => {
    const { container, rerender } = render(
      <TrendChart metrics={METRICS} title="Season timing" highlightYear={2023} />,
    )
    const aprilY = monthLabelY(container, 'Apr')
    expect(aprilY).toBeDefined()
    expect(averageRow()).toEqual(['4 Apr', '19 Oct', '198 days'])

    rerender(<TrendChart metrics={METRICS} title="Season timing" highlightYear={2024} />)
    expect(monthLabelY(container, 'Apr')).toBe(aprilY)
    expect(averageRow()).toEqual(['4 Apr', '19 Oct', '198 days'])
  })

  it('gives the average a length that matches its rounded dates', () => {
    // Average start day 87.818, end day 296.455 and length 208.636: rounded separately, the
    // dates (29 Mar to 23 Oct) would be 208 days apart but the length would say 209.
    const metrics: YearMetric[] = Array.from({ length: 11 }, (_, i) => {
      const year = 2013 + i
      const [sos, eos] = i === 0 ? [86, 301] : [88, 296]
      return {
        year,
        is_forest: true,
        sos_date: dateFromDayOfYear(year, sos),
        eos_date: dateFromDayOfYear(year, eos),
        season_length: eos - sos,
      }
    })
    render(<TrendChart metrics={metrics} title="Season timing" />)
    expect(averageRow()).toEqual(['29 Mar', '23 Oct', '208 days'])
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
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^2019 No data for this year$/)
    act(() => yearBar(2020).focus())
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^2020 3 Apr – no data$/)

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
