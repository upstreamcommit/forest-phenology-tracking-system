/** Pure helpers for hand-built SVG charts: linear scales, round tick values and month ticks. */

export interface LinearScale {
  (value: number): number
  /** Maps a range value (such as a pixel) back to the domain. */
  invert: (rangeValue: number) => number
  readonly domain: readonly [number, number]
  readonly range: readonly [number, number]
}

/**
 * Maps `domain` linearly onto `range`. Either may be reversed (an SVG y axis usually is). A
 * zero-width domain or range maps everything to its midpoint instead of dividing by zero.
 */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): LinearScale {
  const [d0, d1] = domain
  const [r0, r1] = range
  const domainSpan = d1 - d0
  const rangeSpan = r1 - r0

  const scale = (value: number) =>
    domainSpan === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / domainSpan) * rangeSpan
  const invert = (rangeValue: number) =>
    rangeSpan === 0 ? (d0 + d1) / 2 : d0 + ((rangeValue - r0) / rangeSpan) * domainSpan

  return Object.assign(scale, { invert, domain: [d0, d1] as const, range: [r0, r1] as const })
}

/** A step of 1, 2 or 5 times a power of ten, close to `rough`. */
function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(rough))
  const fraction = rough / power
  // Geometric midpoints between 1, 2, 5 and 10, so the tick count lands near the request.
  const nice =
    fraction >= Math.sqrt(50) ? 10 : fraction >= Math.sqrt(10) ? 5 : fraction >= Math.sqrt(2) ? 2 : 1
  return nice * power
}

/**
 * Round tick values inside [min, max], about `approxCount` intervals apart, stepping by
 * 1, 2 or 5 times a power of ten. Values are rounded to the step's decimals, so 0.1 * 3 is 0.3.
 */
export function niceTicks(min: number, max: number, approxCount = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || approxCount < 1) return []
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  if (lo === hi) return [lo]

  const step = niceStep((hi - lo) / approxCount)
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))
  // The epsilon keeps 0.3 / 0.1 = 2.9999999999999996 from dropping the end tick.
  const first = Math.ceil(lo / step - 1e-9)
  const last = Math.floor(hi / step + 1e-9)

  const ticks: number[] = []
  for (let i = first; i <= last; i++) ticks.push(Number((i * step).toFixed(decimals)))
  return ticks
}

const MS_PER_DAY = 86_400_000

/** Day of year (1-based) of the 1st of each month in `year`, January first. */
export function monthTicks(year: number): number[] {
  const jan1 = Date.UTC(year, 0, 1)
  return Array.from({ length: 12 }, (_, month) => (Date.UTC(year, month, 1) - jan1) / MS_PER_DAY + 1)
}

const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' })

/** Short month names, January first, in the same locale as the app's dates. */
export const MONTH_LABELS: readonly string[] = Array.from({ length: 12 }, (_, month) =>
  monthFormat.format(new Date(Date.UTC(2001, month, 1))),
)
