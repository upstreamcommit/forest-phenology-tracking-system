/** Pure helpers for the NDVI curve chart: its axis, line segments, label placement and wording. */
import type { NdviCurve, NdviObservation } from '../../api/types'
import { dayOfYear, formatDayMonth } from '../../lib/dates'
import { niceTicks } from './scales'

/** NDVI as the chart, its tooltips and its table show it: two decimals ("0.43") unless asked. */
export function formatNdvi(value: number, decimals = 2): string {
  return value.toFixed(decimals)
}

/**
 * More decimals than this would be false precision, so values closer than that to the threshold
 * are called "just above" or "just below" it instead.
 */
const MAX_DECIMALS = 3

/**
 * Decimals that tell `ndvi` from the threshold: two, or three when both would show as the same
 * text but differ, so a value shown as 0.41 is never called below a threshold also shown as 0.41.
 */
export function ndviDecimals(ndvi: number, threshold: number | null): number {
  let decimals = 2
  if (threshold === null || ndvi === threshold) return decimals
  const alike = () => formatNdvi(ndvi, decimals) === formatNdvi(threshold, decimals)
  while (decimals < MAX_DECIMALS && alike()) decimals++
  return decimals
}

/** Decimals for the threshold itself: enough to tell it from every observation. */
export function thresholdDecimals({
  observations,
  threshold_ndvi,
}: Pick<NdviCurve, 'observations' | 'threshold_ndvi'>): number {
  return Math.max(
    2,
    ...observations.map((obs) => (obs.ndvi === null ? 2 : ndviDecimals(obs.ndvi, threshold_ndvi))),
  )
}

export interface NdviAxis {
  /** The first and last tick. */
  domain: [number, number]
  ticks: number[]
  /** Decimals that show every tick, so the labels line up: "0.0", "0.2" ... */
  decimals: number
}

const TICK_COUNT = 4
/** Air above and below the data: a tenth of its range, and at least this much NDVI. */
const MIN_PADDING = 0.05

/** lo to hi widened to whole steps of a round tick step, with a tick on every step. */
function wholeSteps(lo: number, hi: number): NdviAxis {
  const rough = niceTicks(lo, hi, TICK_COUNT)
  // One significant figure drops float noise: 0.45 - 0.4 is 0.04999999999999999.
  const step = Number((rough[1] - rough[0]).toPrecision(1))
  // Never for a range wider than nothing, which ndviAxis always asks for.
  if (!(step > 0)) return { domain: [lo, hi], ticks: [lo, hi], decimals: 2 }
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))
  // The epsilons keep values already on a step in place; toFixed drops float noise.
  const first = Math.floor(lo / step + 1e-9)
  const last = Math.ceil(hi / step - 1e-9)
  const ticks = Array.from({ length: last - first + 1 }, (_, i) =>
    Number(((first + i) * step).toFixed(decimals)),
  )
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks, decimals }
}

/**
 * The NDVI axis for a curve: its observations and threshold, padded and widened to whole tick
 * steps. Padding stops at 0 and 1, but values beyond them (water is negative) stay in view.
 */
export function ndviAxis({
  observations,
  threshold_ndvi,
}: Pick<NdviCurve, 'observations' | 'threshold_ndvi'>): NdviAxis {
  const values = observations.flatMap((obs) => (obs.ndvi === null ? [] : [obs.ndvi]))
  if (threshold_ndvi !== null) values.push(threshold_ndvi)
  if (values.length === 0) return wholeSteps(0, 1)

  const min = Math.min(...values)
  const max = Math.max(...values)
  const padding = Math.max((max - min) / 10, MIN_PADDING)
  const lo = Math.max(Math.min(0, min), min - padding)
  const hi = Math.min(Math.max(1, max), max + padding)
  return wholeSteps(lo, hi)
}

export interface NdviPoint {
  doy: number
  ndvi: number
}

/** Runs of consecutive observations that have a value: a missing composite breaks the line. */
export function lineSegments(observations: readonly NdviObservation[]): NdviPoint[][] {
  const segments: NdviPoint[][] = [[]]
  for (const { doy, ndvi } of observations) {
    const current = segments[segments.length - 1]
    if (ndvi !== null) current.push({ doy, ndvi })
    else if (current.length > 0) segments.push([])
  }
  return segments.filter((segment) => segment.length > 0)
}

export interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

export interface XY {
  x: number
  y: number
}

const NARROW = new Set(' .,:;!|ijl')
const MEDIUM = new Set('frtI()')

/**
 * The width of `text` in a sans-serif font of `size` px, for where it cannot be measured (jsdom).
 * It errs a little wide of the system fonts: "Threshold 0.67" at 10px is 74px in San Francisco,
 * about 75px in DejaVu Sans, and 79px by this estimate.
 */
export function estimateTextWidth(text: string, size = 10): number {
  let ems = 0
  for (const char of text) ems += NARROW.has(char) ? 0.32 : MEDIUM.has(char) ? 0.44 : 0.65
  return ems * size
}

/** The box a 10px chart label `width` px wide takes, from its start and baseline. */
export function labelBox(x: number, baseline: number, width: number): Box {
  return { left: x, right: x + width, top: baseline - 10, bottom: baseline + 3 }
}

/** Air kept between the threshold label and anything drawn near it. */
const LABEL_CLEARANCE = 2
/** The radius of a dot, as drawn when active, with its outline. */
const DOT_REACH = 6

function grow(box: Box, by: number): Box {
  return { left: box.left - by, right: box.right + by, top: box.top - by, bottom: box.bottom + by }
}

/** Whether the segment from a to b passes through the box (Liang-Barsky clipping). */
export function segmentHits(a: XY, b: XY, box: Box): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let enter = 0
  let leave = 1
  const edges: [number, number][] = [
    [-dx, a.x - box.left],
    [dx, box.right - a.x],
    [-dy, a.y - box.top],
    [dy, box.bottom - a.y],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const t = q / p
    if (p < 0) enter = Math.max(enter, t)
    else leave = Math.min(leave, t)
    if (enter > leave) return false
  }
  return true
}

export interface ThresholdLabelLayout {
  /** The threshold as shown: "0.45". */
  value: string
  /** The threshold line's y. */
  lineY: number
  plot: Box
  /** x of the computed start and end of season: solid lines the label never covers. */
  markers: number[]
  /** x of the stored start and end: dashed, so the label crosses one only for want of room. */
  storedMarkers: number[]
  /** The curve's dots, and the runs of them joined by its line. */
  dots: XY[]
  lines: XY[][]
  /** The width of a label's text: measured where the browser can, estimated otherwise. */
  measure?: (text: string) => number
}

export interface ThresholdLabelPlace {
  text: string
  /** Its start and baseline. */
  x: number
  baseline: number
}

/** How far above the plot's top the label's baseline goes outside it: over the Start and End. */
const OUTSIDE_RISE = 19

/** What the threshold label can say, longest first: "Threshold 0.45", then "0.45". */
export function thresholdLabelTexts(value: string): [string, string] {
  return [`Threshold ${value}`, value]
}

/**
 * What the threshold label says and where: "Threshold 0.45" just above the threshold line, or
 * else just below it, as far left as it is clear of the markers, the line and the dots. With no
 * clear spot it may cross a dashed stored marker, as few as it can, but it never covers a dot,
 * the line or a computed marker: it shortens to "0.45" instead, and failing that it goes above
 * the plot, where the legend still says what it is.
 */
export function placeThresholdLabel({
  value,
  lineY,
  plot,
  markers,
  storedMarkers,
  dots,
  lines,
  measure = estimateTextWidth,
}: ThresholdLabelLayout): ThresholdLabelPlace {
  const across = (box: Box, mx: number) => mx >= box.left && mx <= box.right
  const covers = (box: Box) => {
    if (box.top < plot.top || box.bottom > plot.bottom) return true
    if (markers.some((mx) => across(box, mx))) return true
    const near = grow(box, DOT_REACH)
    const inNear = ({ x, y }: XY) =>
      x >= near.left && x <= near.right && y >= near.top && y <= near.bottom
    if (dots.some(inNear)) return true
    return lines.some((line) => line.slice(1).some((b, i) => segmentHits(line[i], b, box)))
  }

  const texts = thresholdLabelTexts(value)
  for (const text of texts) {
    const width = measure(text)
    let fallback: (ThresholdLabelPlace & { crossings: number }) | null = null
    // Baselines that keep the label's box 2px clear of the line: above it, then below it.
    for (const baseline of [lineY - 5, lineY + 12]) {
      for (let x = plot.left + 4; x + width <= plot.right - 4; x += 2) {
        const box = grow(labelBox(x, baseline, width), LABEL_CLEARANCE)
        if (covers(box)) continue
        const crossings = storedMarkers.filter((mx) => across(box, mx)).length
        if (crossings === 0) return { text, x, baseline }
        if (!fallback || crossings < fallback.crossings) fallback = { text, x, baseline, crossings }
      }
    }
    if (fallback) return { text, x: fallback.x, baseline: fallback.baseline }
  }
  const [full] = texts
  const x = Math.max(0, plot.right - measure(full))
  return { text: full, x, baseline: plot.top - OUTSIDE_RISE }
}

export type ThresholdRelation = 'above' | 'at' | 'below'

export const RELATION_TEXT: Record<ThresholdRelation, string> = {
  above: 'above the threshold',
  at: 'at the threshold',
  below: 'below the threshold',
}

/** Where a value sits against the threshold, or null when the curve has none (a flat series). */
export function thresholdRelation(
  ndvi: number,
  threshold: number | null,
): ThresholdRelation | null {
  if (threshold === null) return null
  return ndvi > threshold ? 'above' : ndvi < threshold ? 'below' : 'at'
}

/** Whether a value differs from the threshold by less than the decimals shown can tell. */
export function justBeside(ndvi: number, threshold: number | null): boolean {
  if (threshold === null || ndvi === threshold) return false
  return formatNdvi(ndvi, MAX_DECIMALS) === formatNdvi(threshold, MAX_DECIMALS)
}

/**
 * "below the threshold", "just below the threshold" when the two show the same to three
 * decimals, and with the threshold's value ("below the threshold of 0.406") when it takes three
 * to tell them apart, unless `withValue` is false.
 */
export function describeRelation(
  ndvi: number,
  threshold: number | null,
  withValue = true,
): string | null {
  const relation = thresholdRelation(ndvi, threshold)
  if (relation === null || threshold === null) return null
  if (justBeside(ndvi, threshold)) return `just ${RELATION_TEXT[relation]}`
  const decimals = ndviDecimals(ndvi, threshold)
  const text = RELATION_TEXT[relation]
  return withValue && decimals > 2 ? `${text} of ${formatNdvi(threshold, decimals)}` : text
}

/** What a composite is to the computed season: "start of season", "end of season" or null. */
export function seasonEdge(
  doy: number,
  { sos_date, eos_date }: Pick<NdviCurve, 'sos_date' | 'eos_date'>,
): string | null {
  const start = sos_date !== null && dayOfYear(sos_date) === doy
  const end = eos_date !== null && dayOfYear(eos_date) === doy
  if (start && end) return 'start and end of season'
  return start ? 'start of season' : end ? 'end of season' : null
}

/** The accessible name of an observation: "17 Jan: NDVI 0.19, below the threshold". */
export function describeObservation(
  date: string,
  ndvi: number,
  threshold: number | null,
  edge: string | null,
): string {
  const value = formatNdvi(ndvi, ndviDecimals(ndvi, threshold))
  const relation = describeRelation(ndvi, threshold)
  const parts = [`${formatDayMonth(date)}: NDVI ${value}`]
  if (relation) parts.push(relation)
  if (edge) parts.push(edge)
  return parts.join(', ')
}

/** One sentence on when NDVI crosses the threshold, for screen readers. */
export function summariseCurve(curve: NdviCurve): string {
  const observed = curve.observations.flatMap((obs) => (obs.ndvi === null ? [] : [obs.doy]))
  if (observed.length === 0) return 'There are no NDVI observations for this year.'
  if (curve.threshold_ndvi === null) {
    return 'NDVI is flat this year, so there is no seasonal threshold.'
  }
  // The API gives both dates or neither, and neither only without a threshold.
  const { sos_date: sos, eos_date: eos } = curve
  if (!sos || !eos) return 'No season was computed for this year.'

  const [sosDoy, eosDoy] = [dayOfYear(sos), dayOfYear(eos)]
  const length = curve.season_length ?? eosDoy - sosDoy
  if (sosDoy === eosDoy) {
    return `NDVI is above the threshold only on ${formatDayMonth(sos)}, a ${length}-day season.`
  }
  // A season that runs off either end of the year neither rises nor falls there.
  const start =
    sosDoy === Math.min(...observed)
      ? `NDVI is already above the threshold at the first observation (${formatDayMonth(sos)})`
      : `NDVI rises above the threshold on ${formatDayMonth(sos)}`
  const end =
    eosDoy === Math.max(...observed)
      ? `is still above it at the last observation (${formatDayMonth(eos)})`
      : `falls below it after ${formatDayMonth(eos)}`
  return `${start} and ${end}, a ${length}-day season.`
}

export interface StoredDates {
  sos_date?: string | null
  eos_date?: string | null
}

/** The stored start and end of season as a sentence, or null when there are none. */
export function describeStored(stored: StoredDates | null | undefined): string | null {
  const sos = stored?.sos_date
  const eos = stored?.eos_date
  if (sos && eos) {
    return `The stored season runs from ${formatDayMonth(sos)} to ${formatDayMonth(eos)}.`
  }
  if (sos) return `The stored start of season is ${formatDayMonth(sos)}.`
  if (eos) return `The stored end of season is ${formatDayMonth(eos)}.`
  return null
}
