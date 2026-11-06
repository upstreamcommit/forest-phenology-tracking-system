import type { NdviObservation } from '../../api/types'
import { formatDayMonth, parseIsoDate } from '../../lib/dates'
import { formatDays } from '../../lib/format'

const MS_PER_DAY = 86_400_000
const DEFAULT_SPACING_DAYS = 16

/** Whole days from `from` to `to` (positive when `to` is later), or null for a bad date. */
export function daysBetween(from: string, to: string): number | null {
  const a = parseIsoDate(from)
  const b = parseIsoDate(to)
  return a && b ? Math.round((b.getTime() - a.getTime()) / MS_PER_DAY) : null
}

/** "Computed start 7 Apr, 4 days before the stored start". */
export function describeDateShift(
  edge: 'start' | 'end',
  computed: string,
  stored: string,
): string | null {
  const days = daysBetween(stored, computed)
  if (days === null) return null
  const relation =
    days === 0
      ? `the same day as the stored ${edge}`
      : `${formatDays(Math.abs(days))} ${days < 0 ? 'before' : 'after'} the stored ${edge}`
  return `Computed ${edge} ${formatDayMonth(computed)}, ${relation}`
}

/** Days between consecutive composites: the smallest gap in the series, 16 by default. */
export function compositeSpacing(observations: readonly NdviObservation[]): number {
  const doys = observations.map((o) => o.doy).sort((a, b) => a - b)
  let smallest = Infinity
  for (let i = 1; i < doys.length; i++) {
    const gap = doys[i] - doys[i - 1]
    if (gap > 0) smallest = Math.min(smallest, gap)
  }
  return Number.isFinite(smallest) ? smallest : DEFAULT_SPACING_DAYS
}
