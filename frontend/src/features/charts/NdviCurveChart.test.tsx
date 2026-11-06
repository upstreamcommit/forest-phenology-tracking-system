import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { NdviCurve } from '../../api/types'
import { dateFromDayOfYear } from '../../lib/dates'
import { ndviCurveFor, pointFor } from '../../test/fixtures'
import { NdviCurveChart } from './NdviCurveChart'
import { estimateTextWidth, labelBox, segmentHits, type Box } from './ndviCurve'
import { MONTH_LABELS } from './scales'

// The fixture point (51.5, -0.5) in 2021: NDVI 0.18 to 0.73 over 23 composites, threshold 0.45,
// a computed season from 7 Apr (DOY 97) to 16 Oct (DOY 289). Stored: 11 Apr to 20 Oct.
const CURVE = ndviCurveFor(51.5, -0.5, 2021)
const STORED = pointFor(51.5, -0.5, 2021)
const TITLE = 'NDVI through 2021'
const POINT_LABEL = /: NDVI /
const DOYS = CURVE.observations.map((obs) => obs.doy)
/** The chart's height without the bands for the tooltip. */
const CHART_HEIGHT = 240

const NO_SEASON: NdviCurve = { ...CURVE, sos_date: null, eos_date: null, season_length: null }
const FLAT: NdviCurve = {
  ...NO_SEASON,
  observations: CURVE.observations.map((obs) => ({ ...obs, ndvi: 0.3 })),
  threshold_ndvi: null,
}

function withGaps(curve: NdviCurve, doys: number[]): NdviCurve {
  return {
    ...curve,
    observations: curve.observations.map((obs) =>
      doys.includes(obs.doy) ? { ...obs, ndvi: null } : obs,
    ),
  }
}

function withValues(curve: NdviCurve, values: Record<number, number>): NdviCurve {
  return {
    ...curve,
    observations: curve.observations.map((obs) =>
      obs.doy in values ? { ...obs, ndvi: values[obs.doy] } : obs,
    ),
  }
}

function numberAttr(element: Element | null, name: string): number {
  if (!element) throw new Error(`No element for ${name}`)
  return Number(element.getAttribute(name))
}

function dotX(container: HTMLElement, doy: number): number {
  return numberAttr(container.querySelector(`circle[data-doy="${doy}"]`), 'cx')
}

function dotY(container: HTMLElement, doy: number): number {
  return numberAttr(container.querySelector(`circle[data-doy="${doy}"]`), 'cy')
}

function legendItems(container: HTMLElement): (string | null)[] {
  const legend = container.querySelector('ul')
  if (!legend) throw new Error('No legend')
  return within(legend)
    .getAllByRole('listitem', { hidden: true })
    .map((item) => item.textContent)
}

/** The plot's left and right edges, from the gridlines. */
function plotEdges(container: HTMLElement): [number, number] {
  const grid = container.querySelector('line.stroke-line')
  return [numberAttr(grid, 'x1'), numberAttr(grid, 'x2')]
}

function svgTexts(container: HTMLElement, match: (text: string) => boolean): SVGTextElement[] {
  return [...container.querySelectorAll('svg text')].filter((t): t is SVGTextElement =>
    match(t.textContent ?? ''),
  )
}

/** A target's hit area, from its inline style, in the chart's own pixels. */
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
 * targets) has its top at `plot.top`, and a scroller with overflow-y auto shows `scroller`.
 */
function mockLayout(width: number, plot = { top: 100 }, scroller = { top: 0, height: 0 }) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.style.overflowY === 'auto') return new DOMRect(0, scroller.top, width, scroller.height)
    if (this.style.marginTop) return new DOMRect(0, plot.top, width, CHART_HEIGHT)
    return new DOMRect(0, 0, width, 0)
  })
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/** The points of the drawn line, from each path's "M x,y L x,y ..." data. */
function linePoints(container: HTMLElement): { x: number; y: number }[][] {
  return [...container.querySelectorAll('path[data-line]')].map((path) =>
    (path.getAttribute('d') ?? '')
      .split(/[ML]/)
      .filter((part) => part.trim() !== '')
      .map((part) => {
        const [x, y] = part.trim().split(',').map(Number)
        return { x, y }
      }),
  )
}

/**
 * Expects the threshold label, drawn last, to cover no dot, no part of the line and no computed
 * marker, and to cross only the `stored` markers named. Returns its box, `width` px wide.
 */
function expectLabelClear(
  container: HTMLElement,
  width: number,
  stored: string[] = [],
): Box {
  const label = container.querySelector('text[data-threshold-label]')!
  const box = labelBox(numberAttr(label, 'x'), numberAttr(label, 'y'), width)
  const crossed = [...container.querySelectorAll('line[data-marker]')]
    .filter((marker) => {
      const mx = numberAttr(marker, 'x1')
      return mx >= box.left && mx <= box.right
    })
    .map((marker) => marker.getAttribute('data-marker'))
  expect(crossed).toEqual(stored)
  for (const dot of container.querySelectorAll('circle[data-doy]')) {
    const r = 5
    const area = {
      left: numberAttr(dot, 'cx') - r,
      right: numberAttr(dot, 'cx') + r,
      top: numberAttr(dot, 'cy') - r,
      bottom: numberAttr(dot, 'cy') + r,
    }
    expect(overlaps(box, area), `dot ${dot.getAttribute('data-doy')}`).toBe(false)
  }
  for (const line of linePoints(container)) {
    line.slice(1).forEach((b, i) => {
      expect(segmentHits(line[i], b, box), `segment ${i}`).toBe(false)
    })
  }
  // Drawn after everything it could share pixels with.
  expect(container.querySelector('svg')!.lastElementChild).toBe(label)
  return box
}

describe('NdviCurveChart', () => {
  it('draws the observations as a line with a focusable dot each inside a named figure', () => {
    const { container } = render(<NdviCurveChart curve={CURVE} title={TITLE} />)
    expect(screen.getByRole('figure', { name: TITLE })).toBeInTheDocument()

    const lines = container.querySelectorAll('path[data-line]')
    expect(lines).toHaveLength(1)
    expect(lines[0].getAttribute('d')?.match(/[ML]/g)).toHaveLength(23)
    expect(container.querySelectorAll('circle[data-doy]')).toHaveLength(23)

    const points = screen.getAllByRole('img', { name: POINT_LABEL })
    expect(points).toHaveLength(23)
    for (const point of points) expect(point).toHaveAttribute('tabindex', '0')
    expect(points[1]).toHaveAccessibleName('17 Jan: NDVI 0.18, below the threshold')
    expect(points[6]).toHaveAccessibleName('7 Apr: NDVI 0.52, above the threshold, start of season')
    expect(points[18]).toHaveAccessibleName('16 Oct: NDVI 0.58, above the threshold, end of season')

    // Later composites further right, greener ones higher up.
    expect(dotX(container, 17)).toBeLessThan(dotX(container, 193))
    expect(dotY(container, 193)).toBeLessThan(dotY(container, 17))
  })

  it('draws the composites in date order whatever order they come in', async () => {
    const user = userEvent.setup()
    const shuffled = { ...CURVE, observations: [...CURVE.observations].reverse() }
    const { container } = render(<NdviCurveChart curve={shuffled} title={TITLE} />)
    const [line] = linePoints(container)
    expect(line).toHaveLength(23)
    line.slice(1).forEach((point, i) => expect(point.x).toBeGreaterThan(line[i].x))
    expect(screen.getAllByRole('img', { name: POINT_LABEL })[0]).toHaveAccessibleName(
      '1 Jan: NDVI 0.18, below the threshold',
    )

    await user.click(screen.getByRole('button', { name: 'Show data table' }))
    const rows = screen.getAllByRole('rowheader').map((cell) => cell.textContent)
    expect(rows.slice(0, 2)).toEqual(['1 Jan 2021', '17 Jan 2021'])
  })

  it('spreads the year across the plot: 1 Jan at its left edge, 31 Dec ending at its right', () => {
    for (const year of [2021, 2020]) {
      const days = year === 2020 ? 366 : 365
      const curve = { ...ndviCurveFor(51.5, -0.5, year), year }
      const { container, unmount } = render(<NdviCurveChart curve={curve} title={TITLE} />)
      const [left, right] = plotEdges(container)
      for (const doy of [1, 193, 353]) {
        expect(dotX(container, doy)).toBeCloseTo(left + ((doy - 1) / days) * (right - left), 6)
      }
      unmount()
    }
  })

  it('labels the NDVI axis at every gridline, bottom to top', () => {
    const { container } = render(<NdviCurveChart curve={CURVE} title={TITLE} />)
    const labels = svgTexts(container, (text) => /^-?\d+\.\d+$/.test(text))
    expect(labels.map((label) => label.textContent)).toEqual(['0.0', '0.2', '0.4', '0.6', '0.8'])
    const gridlines = [...container.querySelectorAll('line.stroke-line')]
    expect(gridlines).toHaveLength(5)
    labels.forEach((label, i) => {
      // Gridlines sit on the pixel grid; labels sit on the value.
      const offset = numberAttr(label, 'y') - numberAttr(gridlines[i], 'y1')
      expect(Math.abs(offset)).toBeLessThanOrEqual(1)
      expect(numberAttr(label, 'x')).toBeLessThan(plotEdges(container)[0])
    })
    // 0.0 at the bottom of the plot and 0.8 at its top.
    expect(numberAttr(labels[0], 'y')).toBe(216)
    expect(numberAttr(labels[4], 'y')).toBe(18)
  })

  it.each([
    [480, MONTH_LABELS],
    // Every other month where a month is under 22px wide.
    [254, MONTH_LABELS.filter((_, month) => month % 2 === 0)],
  ])('labels the months in the middle of each month, %ipx wide', (width, expected) => {
    mockLayout(width)
    const { container } = render(<NdviCurveChart curve={CURVE} title={TITLE} />)
    const labels = svgTexts(container, (text) => MONTH_LABELS.includes(text))
    expect(labels.map((label) => label.textContent)).toEqual(expected)

    // The month ticks on the axis, then the plot's right edge.
    const ticks = [...container.querySelectorAll('line')]
      .filter((line) => numberAttr(line, 'y2') - numberAttr(line, 'y1') === 4)
      .map((line) => numberAttr(line, 'x1'))
    expect(ticks).toHaveLength(12)
    const edges = [...ticks, plotEdges(container)[1]]
    for (const label of labels) {
      const month = MONTH_LABELS.indexOf(label.textContent ?? '')
      const middle = (edges[month] + edges[month + 1]) / 2
      expect(Math.abs(numberAttr(label, 'x') - middle)).toBeLessThan(1)
    }
  })

  it('gives each composite a target as high as the chart, meeting its neighbours halfway', () => {
    const { container } = render(<NdviCurveChart curve={CURVE} title={TITLE} />)
    const areas = screen.getAllByRole('img', { name: POINT_LABEL }).map(hitArea)
    const xs = CURVE.observations.map((obs) => dotX(container, obs.doy))
    expect(areas).toHaveLength(23)
    for (const area of areas) {
      expect(area.top).toBe(0)
      expect(area.bottom).toBe(CHART_HEIGHT)
    }
    // To a hundredth of a pixel: jsdom shortens the numbers in a style.
    areas.slice(1).forEach((area, i) => {
      expect(areas[i].right).toBeCloseTo((xs[i] + xs[i + 1]) / 2, 2)
      expect(area.left).toBeCloseTo(areas[i].right, 2)
    })
    // The end composites reach as far out as in.
    expect(xs[0] - areas[0].left).toBeCloseTo(areas[0].right - xs[0], 2)
    expect(areas[22].right - xs[22]).toBeCloseTo(xs[22] - areas[22].left, 2)
  })

  it('keeps the targets of composites far apart inside the chart', () => {
    // Only the first and last composites: each would reach halfway across the year.
    const sparse = { ...CURVE, observations: [CURVE.observations[0], CURVE.observations[22]] }
    render(<NdviCurveChart curve={sparse} title={TITLE} />)
    const areas = screen.getAllByRole('img', { name: POINT_LABEL }).map(hitArea)
    expect(areas).toHaveLength(2)
    expect(areas[0].left).toBe(0)
    expect(areas[1].right).toBe(480)
    expect(areas[0].right).toBeCloseTo(areas[1].left, 2)
  })

  it('leaves the place of a missing composite without a target', () => {
    const { container } = render(<NdviCurveChart curve={withGaps(CURVE, [113])} title={TITLE} />)
    const before = hitArea(screen.getByRole('img', { name: /^7 Apr:/ }))
    const after = hitArea(screen.getByRole('img', { name: /^9 May:/ }))
    // Each reaches halfway to where 23 Apr would be, and no further.
    const missing = (dotX(container, 97) + dotX(container, 129)) / 2
    expect(before.right).toBeCloseTo((dotX(container, 97) + missing) / 2, 2)
    expect(after.left).toBeCloseTo((missing + dotX(container, 129)) / 2, 2)
  })

  it('breaks the line at missing values and gives them no dot', () => {
    const { container } = render(
      <NdviCurveChart curve={withGaps(CURVE, [113, 305])} title={TITLE} />,
    )
    const lines = [...container.querySelectorAll('path[data-line]')]
    expect(lines.map((line) => line.getAttribute('d')?.match(/[ML]/g)?.length)).toEqual([7, 11, 3])
    expect(container.querySelectorAll('circle[data-doy]')).toHaveLength(21)
    expect(container.querySelector('circle[data-doy="113"]')).not.toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: POINT_LABEL })).toHaveLength(21)
    expect(screen.queryByRole('img', { name: /^23 Apr:/ })).not.toBeInTheDocument()
  })

  it('draws the threshold as a labelled line between the values either side of it', () => {
    const { container } = render(<NdviCurveChart curve={CURVE} title={TITLE} />)
    expect(screen.getByText('Threshold 0.45')).toBeInTheDocument()
    const thresholdY = numberAttr(container.querySelector('line[data-threshold]'), 'y1')
    // 22 Mar is at 0.29 and 7 Apr at 0.52; up is smaller y.
    expect(thresholdY).toBeLessThan(dotY(container, 81))
    expect(thresholdY).toBeGreaterThan(dotY(container, 97))
  })

  // The fixture's threshold is 0.45 at 50%, 0.67 at 90% and 0.70 at 95%. The higher it is, the
  // less room the curve leaves beside it on a narrow chart.
  it.each([
    [480, 0.5, 'Threshold 0.45', 'at the left, above the line'],
    [324, 0.5, 'Threshold 0.45', 'clear of everything'],
    [254, 0.5, 'Threshold 0.45', 'clear of everything'],
    [324, 0.9, 'Threshold 0.67', 'clear of everything'],
    [254, 0.9, '0.67', 'clear of everything'],
    [324, 0.95, 'Threshold 0.70', 'across the stored start only'],
    [254, 0.95, '0.70', 'clear of everything'],
  ] as const)(
    'keeps the threshold label off the computed markers, the line and the dots, %ipx wide at %f',
    (width, frac, text, where) => {
      mockLayout(width)
      const curve = ndviCurveFor(51.5, -0.5, 2021, frac)
      const { container } = render(<NdviCurveChart curve={curve} stored={STORED} title={TITLE} />)
      const label = container.querySelector('text[data-threshold-label]')!
      expect(label.textContent).toBe(text)
      const box = expectLabelClear(
        container,
        estimateTextWidth(text),
        where === 'across the stored start only' ? ['stored-sos'] : [],
      )
      const lineY = numberAttr(container.querySelector('line[data-threshold]'), 'y1')
      if (where === 'at the left, above the line') {
        expect(box.left).toBe(plotEdges(container)[0] + 4)
        expect(box.bottom).toBeLessThan(lineY)
      }
      // Inside the plot, beside the threshold line.
      expect(box.left).toBeGreaterThan(plotEdges(container)[0])
      expect(box.right).toBeLessThan(plotEdges(container)[1])
      expect(Math.min(Math.abs(box.top - lineY), Math.abs(box.bottom - lineY))).toBeLessThan(4)
    },
  )

  it('moves the threshold label off a stored date where it would otherwise go', () => {
    // 9 Feb (DOY 40) is at x 80, inside where the label goes without it (x 38 to 117), and no
    // computed marker is near.
    const stored = { sos_date: '2021-02-09', eos_date: STORED.eos_date }
    const { container } = render(<NdviCurveChart curve={CURVE} stored={stored} title={TITLE} />)
    const storedX = numberAttr(container.querySelector('line[data-marker="stored-sos"]'), 'x1')
    expect(storedX).toBeGreaterThan(38)
    expect(storedX).toBeLessThan(38 + estimateTextWidth('Threshold 0.45'))

    const label = container.querySelector('text[data-threshold-label]')!
    expect(label.textContent).toBe('Threshold 0.45')
    const box = expectLabelClear(container, estimateTextWidth('Threshold 0.45'))
    expect(storedX < box.left - 2 || storedX > box.right + 2).toBe(true)
  })

  it('places the threshold label by its width as the browser measures it', () => {
    mockLayout(254)
    const curve = ndviCurveFor(51.5, -0.5, 2021, 0.95)
    // jsdom cannot measure text: measure 3px a character, much narrower than the estimate, by
    // which only "0.70" fits.
    Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {
      configurable: true,
      value(this: SVGElement) {
        return (this.textContent ?? '').length * 3
      },
    })
    try {
      const { container } = render(<NdviCurveChart curve={curve} stored={STORED} title={TITLE} />)
      const label = container.querySelector('text[data-threshold-label]')!
      expect(label.textContent).toBe('Threshold 0.70')
      expectLabelClear(container, 14 * 3)
      // The element it was measured in is hidden, and holds no text once done.
      const measuring = container.querySelector('text[visibility="hidden"]')
      expect(measuring).toBeEmptyDOMElement()
    } finally {
      delete (SVGElement.prototype as { getComputedTextLength?: unknown }).getComputedTextLength
    }
  })

  it('shades the computed season and marks its start and end on their composites', () => {
    const { container } = render(<NdviCurveChart curve={CURVE} title={TITLE} />)
    const band = container.querySelector('rect[data-season]')
    expect(numberAttr(band, 'x')).toBe(dotX(container, 97))
    expect(numberAttr(band, 'x') + numberAttr(band, 'width')).toBeCloseTo(dotX(container, 289))

    const start = container.querySelector('line[data-marker="sos"]')
    const end = container.querySelector('line[data-marker="eos"]')
    expect(numberAttr(start, 'x1')).toBe(dotX(container, 97))
    expect(numberAttr(end, 'x1')).toBe(dotX(container, 289))
    expect(start).not.toHaveAttribute('stroke-dasharray')
    expect(screen.getByText('Start')).toBeInTheDocument()
    expect(screen.getByText('End')).toBeInTheDocument()
  })

  it('marks a season that starts and ends on one composite', () => {
    const date = dateFromDayOfYear(2021, 193)
    const single = { ...CURVE, sos_date: date, eos_date: date, season_length: 0 }
    const { container } = render(<NdviCurveChart curve={single} title={TITLE} />)
    expect(screen.getByRole('img', { name: /^12 Jul:/ })).toHaveAccessibleName(
      '12 Jul: NDVI 0.73, above the threshold, start and end of season',
    )
    expect(numberAttr(container.querySelector('line[data-marker="sos"]'), 'x1')).toBe(
      dotX(container, 193),
    )
    expect(screen.getByRole('figure', { name: TITLE })).toHaveAccessibleDescription(
      'NDVI is above the threshold only on 12 Jul, a 0-day season.',
    )
  })

  it('marks the stored dates with dashed lines only when they are given', () => {
    const { container, rerender } = render(<NdviCurveChart curve={CURVE} title={TITLE} />)
    expect(container.querySelector('line[data-marker^="stored"]')).not.toBeInTheDocument()

    rerender(<NdviCurveChart curve={CURVE} stored={{ sos_date: null }} title={TITLE} />)
    expect(container.querySelector('line[data-marker^="stored"]')).not.toBeInTheDocument()

    rerender(<NdviCurveChart curve={CURVE} stored={STORED} title={TITLE} />)
    const start = container.querySelector('line[data-marker="stored-sos"]')
    const end = container.querySelector('line[data-marker="stored-eos"]')
    expect(start).toHaveAttribute('stroke-dasharray')
    expect(end).toHaveAttribute('stroke-dasharray')
    // 11 Apr is DOY 101, between the composites on DOY 97 and 113; 20 Oct is DOY 293.
    const between = (doy: number, from: number, to: number) => {
      const [x0, x1] = [dotX(container, from), dotX(container, to)]
      return x0 + ((doy - from) / (to - from)) * (x1 - x0)
    }
    expect(numberAttr(start, 'x1')).toBeCloseTo(between(101, 97, 113))
    expect(numberAttr(end, 'x1')).toBeCloseTo(between(293, 289, 305))

    rerender(
      <NdviCurveChart curve={CURVE} stored={{ eos_date: STORED.eos_date }} title={TITLE} />,
    )
    expect(container.querySelector('line[data-marker="stored-sos"]')).not.toBeInTheDocument()
    expect(container.querySelector('line[data-marker="stored-eos"]')).toBeInTheDocument()
  })

  it('lists only the legend items that are drawn', () => {
    const { container, rerender } = render(
      <NdviCurveChart curve={CURVE} stored={STORED} title={TITLE} />,
    )
    expect(legendItems(container)).toEqual([
      'NDVI',
      'Threshold',
      'Computed season',
      'Stored start/end',
    ])

    rerender(<NdviCurveChart curve={CURVE} title={TITLE} />)
    expect(legendItems(container)).toEqual(['NDVI', 'Threshold', 'Computed season'])

    rerender(<NdviCurveChart curve={NO_SEASON} title={TITLE} />)
    expect(legendItems(container)).toEqual(['NDVI', 'Threshold'])

    rerender(<NdviCurveChart curve={FLAT} title={TITLE} />)
    expect(legendItems(container)).toEqual(['NDVI'])
  })

  it('shows a tooltip on focus, and hides it on Escape or blur', async () => {
    const user = userEvent.setup()
    render(<NdviCurveChart curve={CURVE} title={TITLE} />)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await user.tab()
    expect(screen.getByRole('img', { name: /^1 Jan:/ })).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      /^1 Jan 2021 · day 1 · NDVI 0\.18Below the threshold$/,
    )

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await user.tab()
    expect(screen.getByRole('tooltip')).toHaveTextContent('17 Jan 2021')

    act(() => screen.getByRole('img', { name: /^7 Apr:/ }).focus())
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      /^7 Apr 2021 · day 97 · NDVI 0\.52Start of season · above the threshold$/,
    )

    act(() => screen.getByRole('img', { name: /^7 Apr:/ }).blur())
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('stops an Escape that closes the tooltip, and passes on one that does not', async () => {
    const user = userEvent.setup()
    const onKeyDown = vi.fn()
    render(
      <div onKeyDown={onKeyDown}>
        <NdviCurveChart curve={CURVE} title={TITLE} />
      </div>,
    )
    await user.tab()
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(onKeyDown).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })

  it('shows a tooltip on hover and enlarges the dot', async () => {
    const user = userEvent.setup()
    const { container } = render(<NdviCurveChart curve={CURVE} title={TITLE} />)
    const point = screen.getByRole('img', { name: /^12 Jul:/ })

    await user.hover(point)
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      /^12 Jul 2021 · day 193 · NDVI 0\.73Above the threshold$/,
    )
    expect(numberAttr(container.querySelector('circle[data-doy="193"]'), 'r')).toBeGreaterThan(
      numberAttr(container.querySelector('circle[data-doy="177"]'), 'r'),
    )

    await user.unhover(point)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows the hovered composite over the focused one, then the focused one again', async () => {
    const user = userEvent.setup()
    render(<NdviCurveChart curve={CURVE} title={TITLE} />)
    await user.tab()
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^1 Jan 2021/)

    await user.hover(screen.getByRole('img', { name: /^12 Jul:/ }))
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^12 Jul 2021/)
    await user.unhover(screen.getByRole('img', { name: /^12 Jul:/ }))
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^1 Jan 2021/)
  })

  it('closes a tooltip opened by hover alone on Escape, with focus elsewhere', async () => {
    const user = userEvent.setup()
    render(<NdviCurveChart curve={CURVE} title={TITLE} />)
    await user.hover(screen.getByRole('img', { name: /^12 Jul:/ }))
    expect(document.activeElement).toBe(document.body)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    // It stays closed until the pointer moves onto a composite again.
    await user.hover(screen.getByRole('img', { name: /^28 Jul:/ }))
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^28 Jul 2021/)
  })

  it('keeps a tooltip opened by hover open on keys other than Escape', async () => {
    const user = userEvent.setup()
    render(<NdviCurveChart curve={CURVE} title={TITLE} />)
    await user.hover(screen.getByRole('img', { name: /^12 Jul:/ }))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^12 Jul 2021/)

    // Tab moves focus to the first composite, but the one under the pointer still shows.
    await user.tab()
    expect(screen.getByRole('img', { name: /^1 Jan:/ })).toHaveFocus()
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^12 Jul 2021/)
  })

  it('keeps the tooltip open while the pointer moves onto it (WCAG 1.4.13)', async () => {
    const user = userEvent.setup()
    render(<NdviCurveChart curve={CURVE} title={TITLE} />)
    const point = screen.getByRole('img', { name: /^7 Apr:/ })
    await user.hover(point)
    const tooltip = screen.getByRole('tooltip')

    // Moving onto the tooltip keeps the composite it describes.
    fireEvent.mouseOut(point, { relatedTarget: tooltip })
    expect(screen.getByRole('tooltip')).toBe(tooltip)
    expect(tooltip).toHaveTextContent(/^7 Apr 2021/)

    // Leaving it for another composite shows that one; leaving the chart hides it.
    const next = screen.getByRole('img', { name: /^23 Apr:/ })
    fireEvent.mouseOut(tooltip, { relatedTarget: next })
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^23 Apr 2021/)
    fireEvent.mouseOut(next, { relatedTarget: document.body })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    // Leaving the tooltip itself for outside the chart hides it too.
    fireEvent.mouseOver(point, { relatedTarget: document.body })
    fireEvent.mouseOut(point, { relatedTarget: screen.getByRole('tooltip') })
    fireEvent.mouseOut(screen.getByRole('tooltip'), { relatedTarget: document.body })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  // With the plot's top 100px down the viewport the band above it shows; at 0 it is off screen.
  it.each([
    [254, 'above', 100],
    [324, 'above', 100],
    [514, 'above', 100],
    [254, 'below', 0],
    [324, 'below', 0],
    [514, 'below', 0],
  ] as const)(
    'puts the tooltip in line with its dot, clear of every other composite, %ipx wide, %s the plot',
    (width, side, plotTop) => {
      mockLayout(width, { top: plotTop })
      const { container } = render(<NdviCurveChart curve={CURVE} stored={STORED} title={TITLE} />)
      const targets = screen.getAllByRole('img', { name: POINT_LABEL })
      const areas = targets.map(hitArea)
      expect(areas.flatMap((a) => Object.values(a)).every(Number.isFinite)).toBe(true)
      const plot = targets[0].parentElement!
      const band = {
        above: parseFloat(plot.style.marginTop),
        below: parseFloat(plot.style.marginBottom),
      }
      const xs = [...container.querySelectorAll('circle[data-doy]')].map((dot) =>
        numberAttr(dot, 'cx'),
      )

      for (const [index, target] of targets.entries()) {
        act(() => target.focus())
        const tooltip = screen.getByRole('tooltip')
        expect(tooltipSide(tooltip)).toBe(side)
        const own = areas[index]
        // Two lines, at most as wide as the chart (its second line never wraps).
        for (const [w, h] of [
          [190, 42],
          [width, 42],
        ]) {
          const box = tooltipBox(tooltip, w, h)
          expect(Object.values(box).every(Number.isFinite)).toBe(true)
          // Inside the chart, to a hundredth of a pixel (jsdom shortens the numbers in a style).
          expect(box.left).toBeGreaterThan(-0.01)
          expect(box.right).toBeLessThan(width + 0.01)
          // Straight up (or down) from the dot, with no gap to cross on the way.
          expect(box.left).toBeLessThan(xs[index])
          expect(box.right).toBeGreaterThan(xs[index])
          if (side === 'above') expect(box.bottom).toBe(own.top)
          else expect(box.top).toBe(own.bottom)
          areas.forEach((area, other) => {
            if (other !== index) expect(overlaps(box, area), `composite ${other}`).toBe(false)
          })
          // It fits the room kept for it, so it covers nothing around the plot.
          if (side === 'above') expect(box.top).toBeGreaterThanOrEqual(-band.above)
          else expect(box.bottom).toBeLessThanOrEqual(CHART_HEIGHT + band.below)
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
        <NdviCurveChart curve={CURVE} title={TITLE} />
      </div>,
    )
    const scroller = screen.getByTestId('scroller')
    Object.defineProperty(scroller, 'clientHeight', { value: 500 })
    const scroll = (top: number) => {
      plot.top = top
      fireEvent.scroll(scroller)
    }

    await user.hover(screen.getByRole('img', { name: /^12 Jul:/ }))
    expect(tooltipSide(screen.getByRole('tooltip'))).toBe('above')
    // The band above is 44px: 120 leaves 20px of it in view, 144 all of it.
    scroll(120)
    expect(tooltipSide(screen.getByRole('tooltip'))).toBe('below')
    scroll(144)
    expect(tooltipSide(screen.getByRole('tooltip'))).toBe('above')
    // Scrolled up past the scroller's top, the plot shows only its lower part.
    scroll(-50)
    expect(tooltipSide(screen.getByRole('tooltip'))).toBe('below')
    scroll(300)
    expect(tooltipSide(screen.getByRole('tooltip'))).toBe('above')
    await user.unhover(screen.getByRole('img', { name: /^12 Jul:/ }))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    // Placed when the pointer opens it, before any scroll.
    plot.top = 90
    await user.hover(screen.getByRole('img', { name: /^28 Jul:/ }))
    expect(tooltipSide(screen.getByRole('tooltip'))).toBe('below')
    await user.unhover(screen.getByRole('img', { name: /^28 Jul:/ }))

    // Placed when it opens, on focus too, and still closed by Escape.
    plot.top = 300
    act(() => screen.getByRole('img', { name: /^7 Apr:/ }).focus())
    expect(tooltipSide(screen.getByRole('tooltip'))).toBe('above')
    act(() => screen.getByRole('img', { name: /^7 Apr:/ }).blur())
    plot.top = 90
    act(() => screen.getByRole('img', { name: /^23 Apr:/ }).focus())
    expect(tooltipSide(screen.getByRole('tooltip'))).toBe('below')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^23 Apr:/ })).toHaveFocus()
  })

  it('stops following scrolls once the tooltip closes', () => {
    mockLayout(400, { top: 300 })
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    render(<NdviCurveChart curve={CURVE} title={TITLE} />)
    const point = screen.getByRole('img', { name: /^12 Jul:/ })
    expect(add).not.toHaveBeenCalledWith('scroll', expect.anything(), expect.anything())

    act(() => point.focus())
    const [, listener] = add.mock.calls.find(([type]) => type === 'scroll')!
    act(() => point.blur())
    const capturing = expect.objectContaining({ capture: true })
    expect(remove).toHaveBeenCalledWith('scroll', listener, capturing)
  })

  it('shows a value and the threshold to three decimals where two show them equal', async () => {
    const user = userEvent.setup()
    // As the API answers for (51.0, -0.6) in 2021: 1 Nov is just below the threshold.
    const close = { ...withValues(CURVE, { 305: 0.405426 }), threshold_ndvi: 0.405996 }
    const { container } = render(<NdviCurveChart curve={close} title={TITLE} />)
    const point = screen.getByRole('img', { name: /^1 Nov:/ })
    expect(point).toHaveAccessibleName('1 Nov: NDVI 0.405, below the threshold of 0.406')
    expect(container.querySelector('text[data-threshold-label]')).toHaveTextContent(
      'Threshold 0.406',
    )
    // Others keep two decimals.
    expect(screen.getByRole('img', { name: /^17 Jan:/ })).toHaveAccessibleName(
      '17 Jan: NDVI 0.18, below the threshold',
    )

    act(() => point.focus())
    // The threshold's value is on the chart, so the tooltip leaves it out.
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      /^1 Nov 2021 · day 305 · NDVI 0\.405Below the threshold$/,
    )

    await user.click(screen.getByRole('button', { name: 'Show data table' }))
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader')[3]).toHaveTextContent('Threshold (0.406)')
    const cells = (name: RegExp) =>
      within(within(table).getByRole('row', { name }))
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    expect(cells(/^1 Nov 2021/)).toEqual(['305', '0.405', 'Below'])
    expect(cells(/^17 Jan 2021/)).toEqual(['17', '0.18', 'Below'])
  })

  it('shows three decimals at most, and says "just" where they show the two the same', async () => {
    const user = userEvent.setup()
    // As the API answers for (51.1, -0.4) in 2021 at 85%: one composite at 0.703951, threshold
    // 0.703953. Another just above it here.
    const close = {
      ...withValues(CURVE, { 305: 0.703951, 321: 0.703958 }),
      threshold_ndvi: 0.703953,
    }
    const { container } = render(<NdviCurveChart curve={close} title={TITLE} />)
    expect(container.querySelector('text[data-threshold-label]')).toHaveTextContent(
      'Threshold 0.704',
    )
    const point = screen.getByRole('img', { name: /^1 Nov:/ })
    expect(point).toHaveAccessibleName('1 Nov: NDVI 0.704, just below the threshold')
    expect(screen.getByRole('img', { name: /^17 Nov:/ })).toHaveAccessibleName(
      '17 Nov: NDVI 0.704, just above the threshold',
    )
    act(() => point.focus())
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      /^1 Nov 2021 · day 305 · NDVI 0\.704Just below the threshold$/,
    )

    await user.click(screen.getByRole('button', { name: 'Show data table' }))
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader')[3]).toHaveTextContent('Threshold (0.704)')
    const cells = (name: RegExp) =>
      within(within(table).getByRole('row', { name }))
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    expect(cells(/^1 Nov 2021/)).toEqual(['305', '0.704', 'Just below'])
    expect(cells(/^17 Nov 2021/)).toEqual(['321', '0.704', 'Just above'])
    expect(cells(/^17 Jan 2021/)).toEqual(['17', '0.18', 'Below'])
    expect(container.textContent).not.toMatch(/\d\.\d{4}/)
  })

  it('keeps the tooltip two lines high on a phone-wide chart, the threshold in the name', () => {
    mockLayout(254)
    // 16 Oct, the end of the season, above a threshold it takes three decimals to tell it from.
    const close = { ...withValues(CURVE, { 289: 0.4534 }), threshold_ndvi: 0.4519 }
    render(<NdviCurveChart curve={close} title={TITLE} />)
    const point = screen.getByRole('img', { name: /^16 Oct:/ })
    expect(point).toHaveAccessibleName(
      '16 Oct: NDVI 0.453, above the threshold of 0.452, end of season',
    )

    act(() => point.focus())
    const [first, second] = screen.getByRole('tooltip').querySelectorAll('p')
    expect(first).toHaveTextContent(/^16 Oct 2021 · day 289 · NDVI 0\.453$/)
    // The edge, then the relation without the threshold's value, on a line one line high, so a
    // relation with no room beside the edge is cut, not wrapped (e2e/ndviChart.spec.ts measures
    // it in a browser).
    expect(second.textContent).toBe('End of season · above the threshold')
    expect(second).toHaveClass('h-4', 'overflow-hidden')
    expect(second.firstElementChild).toHaveTextContent('End of season')
  })

  it('says when a value is exactly at the threshold', async () => {
    const user = userEvent.setup()
    const at = withValues(CURVE, { 305: CURVE.threshold_ndvi! })
    render(<NdviCurveChart curve={at} title={TITLE} />)
    expect(screen.getByRole('img', { name: /^1 Nov:/ })).toHaveAccessibleName(
      '1 Nov: NDVI 0.45, at the threshold',
    )
    await user.click(screen.getByRole('button', { name: 'Show data table' }))
    const row = screen.getByRole('row', { name: /^1 Nov 2021/ })
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      '305',
      '0.45',
      'At',
    ])
  })

  it('summarises the season for screen readers', () => {
    const { rerender } = render(<NdviCurveChart curve={CURVE} title={TITLE} />)
    const figure = () => screen.getByRole('figure', { name: TITLE })
    expect(figure()).toHaveAccessibleDescription(
      'NDVI rises above the threshold on 7 Apr and falls below it after 16 Oct, a 192-day season.',
    )

    rerender(<NdviCurveChart curve={CURVE} stored={STORED} title={TITLE} />)
    expect(figure()).toHaveAccessibleDescription(
      'NDVI rises above the threshold on 7 Apr and falls below it after 16 Oct, a 192-day ' +
        'season. The stored season runs from 11 Apr to 20 Oct.',
    )

    rerender(
      <NdviCurveChart
        curve={CURVE}
        stored={{ sos_date: STORED.sos_date, eos_date: null }}
        title={TITLE}
      />,
    )
    expect(figure()).toHaveAccessibleDescription(
      /a 192-day season\. The stored start of season is 11 Apr\.$/,
    )
  })

  it('does not say NDVI rises or falls at the ends of the year when the season meets them', () => {
    // As at a 5% threshold: above it from the first composite to the last.
    const low: NdviCurve = {
      ...CURVE,
      threshold_ndvi: 0.18001,
      sos_date: '2021-01-01',
      eos_date: '2021-12-19',
      season_length: 352,
    }
    render(<NdviCurveChart curve={low} title={TITLE} />)
    expect(screen.getByRole('figure', { name: TITLE })).toHaveAccessibleDescription(
      'NDVI is already above the threshold at the first observation (1 Jan) and is still above ' +
        'it at the last observation (19 Dec), a 352-day season.',
    )
  })

  it('says when there are no observations, and draws no line or dots', () => {
    const empty = {
      ...withGaps(NO_SEASON, DOYS),
      threshold_ndvi: null,
    }
    const { container } = render(<NdviCurveChart curve={empty} title={TITLE} />)
    expect(screen.getByRole('figure', { name: TITLE })).toHaveAccessibleDescription(
      'There are no NDVI observations for this year.',
    )
    expect(container.querySelector('path[data-line]')).not.toBeInTheDocument()
    expect(container.querySelector('circle[data-doy]')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: POINT_LABEL })).not.toBeInTheDocument()
  })

  it('says when there is no season, and draws no season marks', () => {
    const { container } = render(<NdviCurveChart curve={NO_SEASON} title={TITLE} />)
    expect(screen.getByRole('figure', { name: TITLE })).toHaveAccessibleDescription(
      'No season was computed for this year.',
    )
    expect(container.querySelector('rect[data-season]')).not.toBeInTheDocument()
    expect(container.querySelector('line[data-marker]')).not.toBeInTheDocument()
    expect(container.querySelector('line[data-threshold]')).toBeInTheDocument()
  })

  it('says when the series is flat, and draws no threshold', () => {
    const { container } = render(<NdviCurveChart curve={FLAT} title={TITLE} />)
    expect(screen.getByRole('figure', { name: TITLE })).toHaveAccessibleDescription(
      'NDVI is flat this year, so there is no seasonal threshold.',
    )
    expect(container.querySelector('line[data-threshold]')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Threshold/)).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^17 Jan:/ })).toHaveAccessibleName('17 Jan: NDVI 0.30')
    act(() => screen.getByRole('img', { name: /^17 Jan:/ }).focus())
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^17 Jan 2021 · day 17 · NDVI 0\.30$/)
  })

  it('reveals a data table with a row per observation', async () => {
    const user = userEvent.setup()
    render(<NdviCurveChart curve={withGaps(CURVE, [305])} title={TITLE} />)
    const toggle = screen.getByRole('button', { name: 'Show data table' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAccessibleName('Hide data table')
    const table = screen.getByRole('table', { name: `${TITLE}, by date` })
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Date',
      'Day of year',
      'NDVI',
      'Threshold (0.45)',
    ])
    // Header and 23 composites.
    expect(within(table).getAllByRole('row')).toHaveLength(24)

    const cells = (name: RegExp) =>
      within(within(table).getByRole('row', { name }))
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    expect(cells(/^17 Jan 2021/)).toEqual(['17', '0.18', 'Below'])
    expect(cells(/^12 Jul 2021/)).toEqual(['193', '0.73', 'Above'])
    expect(cells(/^1 Nov 2021/)).toEqual(['305', 'No data', '–'])
    expect(within(table).getByRole('rowheader', { name: /^7 Apr 2021/ })).toHaveTextContent(
      '7 Apr 2021 (start of season)',
    )
    expect(cells(/^7 Apr 2021/)).toEqual(['97', '0.52', 'Above'])

    await user.click(toggle)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('leaves the threshold column out of the table for a flat series', async () => {
    const user = userEvent.setup()
    render(<NdviCurveChart curve={FLAT} title={TITLE} />)
    await user.click(screen.getByRole('button', { name: 'Show data table' }))
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Date',
      'Day of year',
      'NDVI',
    ])
  })
})
