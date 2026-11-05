import type { YearMetric } from '../../api/types'
import { dayOfYear } from '../../lib/dates'

type SeasonFields = Pick<YearMetric, 'year' | 'sos_date' | 'eos_date' | 'season_length'>

/** One season as days of year, so seasons from different years can be compared. */
export interface SeasonDays {
  year: number
  sos: number
  eos: number
  /** Days from start to end of season. */
  length: number
}

/** The season's start and end as days of year, or null when either date is missing. */
export function seasonDays(metric: SeasonFields): SeasonDays | null {
  if (!metric.sos_date || !metric.eos_date) return null
  const sos = dayOfYear(metric.sos_date)
  const eos = dayOfYear(metric.eos_date)
  return { year: metric.year, sos, eos, length: metric.season_length ?? eos - sos }
}

export interface SeasonAverage {
  /** Mean start and end, as (fractional) days of year. */
  sos: number
  eos: number
  length: number
  /** How many years had both dates, and the first and last of them. */
  count: number
  firstYear: number
  lastYear: number
}

/** The mean season over every year that has both dates, or null when none has. */
export function averageSeason(metrics: readonly SeasonFields[]): SeasonAverage | null {
  const seasons = metrics.map(seasonDays).filter((s): s is SeasonDays => s !== null)
  if (seasons.length === 0) return null
  const mean = (pick: (s: SeasonDays) => number) =>
    seasons.reduce((sum, s) => sum + pick(s), 0) / seasons.length
  const years = seasons.map((s) => s.year)
  return {
    sos: mean((s) => s.sos),
    eos: mean((s) => s.eos),
    length: mean((s) => s.length),
    count: seasons.length,
    firstYear: Math.min(...years),
    lastYear: Math.max(...years),
  }
}

/** "2016–2026", or a single year when the range is one year. */
export function yearRange(first: number, last: number): string {
  return first === last ? String(first) : `${first}–${last}`
}
