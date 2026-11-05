import { formatDays } from '../../lib/format'
import { yearRange, type SeasonAverage, type SeasonDays } from '../charts/seasons'

function timing(verb: string, shift: number): string {
  if (shift === 0) return `${verb} on the average day`
  return `${verb} ${formatDays(Math.abs(shift))} ${shift < 0 ? 'earlier' : 'later'} than average`
}

/**
 * How one season compares with the point's average, in whole days: its length, start and end.
 * Starts and ends are compared as days of year.
 */
export function describeComparison(season: SeasonDays, average: SeasonAverage): string[] {
  const range = yearRange(average.firstYear, average.lastYear)
  // `|| 0` turns Math.round's -0 into 0.
  const length = Math.round(season.length - average.length) || 0
  const start = Math.round(season.sos - average.sos) || 0
  const end = Math.round(season.eos - average.eos) || 0

  const lengthText =
    length === 0
      ? `Season length matches this point's ${range} average`
      : `Season ${formatDays(Math.abs(length))} ${length > 0 ? 'longer' : 'shorter'} than this point's ${range} average`
  return [lengthText, timing('Started', start), timing('Ended', end)]
}
