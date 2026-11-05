import type { ExpressionSpecification } from 'maplibre-gl'

import type { ResolvedTheme } from '../../lib/theme'
import { METRICS, type MetricKey } from './metrics'

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

export interface GradientLegend extends LegendBase {
  kind: 'gradient'
  /** Colour stops for a left-to-right CSS gradient. */
  stops: { offset: number; colour: string }[]
  ticks: LegendTick[]
  /** Values below the first tick exist and are drawn in the first colour. */
  clampedLow: boolean
  /** Values above the last tick exist and are drawn in the last colour. */
  clampedHigh: boolean
}

export interface CategoryLegend extends LegendBase {
  kind: 'categories'
  items: { value: number; label: string; colour: string }[]
}

/** The legend has no scale to show: no cell has a value for the metric. */
export interface EmptyLegend extends LegendBase {
  kind: 'empty'
}

export type LegendData = GradientLegend | CategoryLegend | EmptyLegend

export interface ColourScale {
  metric: MetricKey
  /** The value range the palette spans (numeric metrics with data only). */
  domain: [number, number] | null
  /** MapLibre fill-color for features whose property `metric` holds the value. */
  fillColor: ExpressionSpecification
  legend: LegendData
  /** The colour drawn for one value, for legends and panels. */
  colourFor: (value: number | null) => string
}

/** Linear-interpolated quantile (type 7) of an ascending array. */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN
  const h = (sorted.length - 1) * Math.min(1, Math.max(0, p))
  const lo = Math.floor(h)
  const hi = Math.min(lo + 1, sorted.length - 1)
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo])
}

/** The rounding step for a domain: 5 days for narrow spreads, 10 for wider ones. */
export function niceStep(span: number): number {
  return span > 50 ? 10 : 5
}

function finiteValues(values: readonly (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b)
}

/**
 * The range a sequential palette spans: the 2nd to 98th percentile of the values, rounded
 * outward to a multiple of 5 or 10, so one outlier cannot wash out the rest of the map.
 * Null when there are no values.
 */
export function robustDomain(values: readonly (number | null)[]): [number, number] | null {
  const sorted = finiteValues(values)
  if (sorted.length === 0) return null
  const p2 = quantile(sorted, 0.02)
  const p98 = quantile(sorted, 0.98)
  const step = niceStep(p98 - p2)
  const min = Math.floor(p2 / step) * step
  let max = Math.ceil(p98 / step) * step
  if (max <= min) max = min + step
  return [min, max]
}

/** Where each palette colour sits in the domain, evenly spaced. */
function paletteStops([min, max]: [number, number]): { value: number; colour: string }[] {
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
export function sequentialColour(value: number, domain: [number, number]): string {
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

/**
 * Tick values for the legend: both ends of the domain plus round values between them, at most
 * five in all, never crowding an end.
 */
export function legendTickValues([min, max]: [number, number]): number[] {
  const span = max - min
  const base = niceStep(span)
  const tickStep = [1, 2, 5, 10, 20, 50].map((k) => k * base).find((s) => span / s <= 4) ?? span
  const ticks = [min]
  // Interior ticks keep three quarters of a step clear of the ends, or their labels collide.
  const clearance = tickStep * 0.75
  for (let v = Math.ceil(min / tickStep) * tickStep; v < max; v += tickStep) {
    if (v - min >= clearance && max - v >= clearance) ticks.push(v)
  }
  ticks.push(max)
  return ticks
}

function hasNull(values: readonly (number | null)[]): boolean {
  return values.some((v) => v === null || !Number.isFinite(v))
}

/**
 * The colour scale for one metric over the values currently on the map. Numeric metrics get the
 * sequential palette over a robust domain; the forest flag gets two category colours.
 */
export function buildColourScale({
  metric,
  values,
  theme,
  year,
}: {
  metric: MetricKey
  values: readonly (number | null)[]
  theme: ResolvedTheme
  /** The year shown, so day-of-year ticks read as that year's dates. */
  year?: number
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

  const domain = robustDomain(values)
  if (domain === null) {
    return {
      metric,
      domain: null,
      fillColor: ['to-color', noDataColour],
      legend: { kind: 'empty', noData },
      colourFor: () => noDataColour,
    }
  }

  const [min, max] = domain
  const finite = finiteValues(values)
  const clampedLow = finite[0] < min
  const clampedHigh = finite[finite.length - 1] > max
  const ticks = legendTickValues(domain).map((value, i, all) => {
    const label = definition.format(value, year)
    const isLast = i === all.length - 1
    const prefix = i === 0 && clampedLow ? '≤ ' : isLast && clampedHigh ? '≥ ' : ''
    return { value, offset: (value - min) / (max - min), label: `${prefix}${label}` }
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
      clampedLow,
      clampedHigh,
      noData,
    },
    colourFor: (value) =>
      value === null || !Number.isFinite(value) ? noDataColour : sequentialColour(value, domain),
  }
}
