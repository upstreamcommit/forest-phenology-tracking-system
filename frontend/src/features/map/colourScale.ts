import type { ExpressionSpecification } from 'maplibre-gl'

import type { ResolvedTheme } from '../../lib/theme'
import { type Domain, METRICS, type MetricKey } from './metrics'

/**
 * viridis in nine stops: perceptually uniform, ordered in lightness (so it survives greyscale)
 * and readable with the common colour-vision deficiencies. The same in both themes: cells are
 * drawn nearly opaque, so the basemap underneath hardly shifts them.
 */
export const SEQUENTIAL_PALETTE = [
  '#440154',
  '#472d7b',
  '#3b528b',
  '#2c728e',
  '#21918c',
  '#28ae80',
  '#5ec962',
  '#addc30',
  '#fde725',
] as const

/** Forest and open land differ in lightness as well as hue, and each theme gets a pair that
 * stands out from its basemap. */
export const CATEGORY_COLOURS: Record<ResolvedTheme, { forest: string; open: string }> = {
  light: { forest: '#1b7837', open: '#dfc27d' },
  dark: { forest: '#5aae61', open: '#ead9ad' },
}

/** A neutral grey, which no palette above contains. */
export const NO_DATA_COLOUR: Record<ResolvedTheme, string> = {
  light: '#a3aaa5',
  dark: '#5f6762',
}

export const NO_DATA_LABEL = 'No data'

export interface LegendTick {
  value: number
  /** Position along the bar, 0 (left) to 1 (right). */
  offset: number
  label: string
}

interface LegendBase {
  /** Shown when some cells have no value for the metric. */
  noData: { label: string; colour: string } | null
}

/** The bar's end colours also stand for every value beyond them, so the end labels say so. */
export interface GradientLegend extends LegendBase {
  kind: 'gradient'
  /** Colour stops for a left-to-right CSS gradient. */
  stops: { offset: number; colour: string }[]
  ticks: LegendTick[]
}

export interface CategoryLegend extends LegendBase {
  kind: 'categories'
  items: { value: number; label: string; colour: string }[]
}

export type LegendData = GradientLegend | CategoryLegend

export interface ColourScale {
  metric: MetricKey
  /** The value range the palette spans (numeric metrics only), the same in every year. */
  domain: Domain | null
  /** MapLibre fill-color for features whose property `metric` holds the value. */
  fillColor: ExpressionSpecification
  legend: LegendData
  /** The colour drawn for one value, for legends and panels. */
  colourFor: (value: number | null) => string
}

/** Where each palette colour sits in the domain, evenly spaced. */
function paletteStops([min, max]: Domain): { value: number; colour: string }[] {
  const last = SEQUENTIAL_PALETTE.length - 1
  return SEQUENTIAL_PALETTE.map((colour, i) => ({ value: min + ((max - min) * i) / last, colour }))
}

function parseHex(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex(rgb: number[]): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
}

/** The palette colour for a value, interpolated in RGB as MapLibre does and clamped at the
 * ends. */
export function sequentialColour(value: number, domain: Domain): string {
  const stops = paletteStops(domain)
  if (value <= stops[0].value) return stops[0].colour
  const last = stops[stops.length - 1]
  if (value >= last.value) return last.colour
  const i = stops.findIndex((s) => s.value > value)
  const a = stops[i - 1]
  const b = stops[i]
  const t = (value - a.value) / (b.value - a.value)
  const ca = parseHex(a.colour)
  const cb = parseHex(b.colour)
  return toHex(ca.map((c, k) => c + t * (cb[k] - c)))
}

const TICK_STEPS = [5, 10, 20, 30, 50, 100]

/**
 * Tick values for the legend: both ends of the domain plus round values between them, at most
 * five in all, never crowding an end.
 */
export function legendTickValues([min, max]: Domain): number[] {
  const span = max - min
  const tickStep = TICK_STEPS.find((s) => span / s <= 4) ?? span
  const ticks = [min]
  // Interior ticks keep three quarters of a step clear of the ends, or their labels collide.
  const clearance = tickStep * 0.75
  for (let v = Math.ceil(min / tickStep) * tickStep; v < max; v += tickStep) {
    if (v - min >= clearance && max - v >= clearance) ticks.push(v)
  }
  ticks.push(max)
  return ticks
}

/** Estimated width of one character of a legend label (12px text), and the gap labels keep. */
const LABEL_CHAR_WIDTH = 7
const LABEL_GAP = 8

/**
 * The ticks whose labels fit side by side on a bar `width` pixels wide: both ends always, and an
 * interior tick only when its label keeps a small gap from its neighbours. Widths are estimated
 * from the label length; the first label starts at its tick, the last ends at its tick and the
 * others are centred on theirs.
 */
export function fitTicks(ticks: readonly LegendTick[], width: number): LegendTick[] {
  const last = ticks.length - 1
  if (last < 2) return [...ticks]
  const extent = (i: number): [number, number] => {
    const labelWidth = ticks[i].label.length * LABEL_CHAR_WIDTH
    const x = ticks[i].offset * width
    if (i === 0) return [x, x + labelWidth]
    if (i === last) return [x - labelWidth, x]
    return [x - labelWidth / 2, x + labelWidth / 2]
  }
  const lastStart = extent(last)[0]
  const kept = [ticks[0]]
  let previousEnd = extent(0)[1]
  for (let i = 1; i < last; i++) {
    const [start, end] = extent(i)
    if (start - previousEnd >= LABEL_GAP && lastStart - end >= LABEL_GAP) {
      kept.push(ticks[i])
      previousEnd = end
    }
  }
  kept.push(ticks[last])
  return kept
}

function hasNull(values: readonly (number | null)[]): boolean {
  return values.some((v) => v === null || !Number.isFinite(v))
}

/**
 * The colour scale for one metric. Numeric metrics get the sequential palette over the metric's
 * fixed domain, the same in every year; the forest flag gets two category colours. `values` are
 * the values on the map, which only decide whether the legend needs a "No data" entry; leave
 * them out while no grid has loaded.
 */
export function buildColourScale({
  metric,
  values = [],
  theme,
}: {
  metric: MetricKey
  values?: readonly (number | null)[]
  theme: ResolvedTheme
}): ColourScale {
  const definition = METRICS[metric]
  const noDataColour = NO_DATA_COLOUR[theme]
  const noData = hasNull(values) ? { label: NO_DATA_LABEL, colour: noDataColour } : null
  const property: ExpressionSpecification = ['get', metric]

  if (definition.kind === 'categorical') {
    const { forest, open } = CATEGORY_COLOURS[theme]
    return {
      metric,
      domain: null,
      fillColor: ['match', property, 1, forest, 0, open, noDataColour],
      legend: {
        kind: 'categories',
        items: [
          { value: 1, label: definition.format(1), colour: forest },
          { value: 0, label: definition.format(0), colour: open },
        ],
        noData,
      },
      colourFor: (value) => (value === 1 ? forest : value === 0 ? open : noDataColour),
    }
  }

  const { domain } = definition
  const [min, max] = domain
  // Day-of-year ticks read as dates of a non-leap year, so the legend is the same every year.
  const ticks = legendTickValues(domain).map((value, i, all) => {
    const prefix = i === 0 ? '≤ ' : i === all.length - 1 ? '≥ ' : ''
    const label = `${prefix}${definition.format(value)}`
    return { value, offset: (value - min) / (max - min), label }
  })

  const stops = paletteStops(domain).flatMap((s) => [s.value, s.colour])
  return {
    metric,
    domain,
    fillColor: [
      'case',
      ['==', ['typeof', property], 'number'],
      ['interpolate', ['linear'], property, ...stops],
      noDataColour,
    ],
    legend: {
      kind: 'gradient',
      stops: SEQUENTIAL_PALETTE.map((colour, i) => ({
        offset: i / (SEQUENTIAL_PALETTE.length - 1),
        colour,
      })),
      ticks,
      noData,
    },
    colourFor: (value) =>
      value === null || !Number.isFinite(value) ? noDataColour : sequentialColour(value, domain),
  }
}
