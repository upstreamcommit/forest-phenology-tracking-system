/**
 * Dates from the API are calendar dates ("2021-04-11"). `new Date("2021-04-11")` parses them as
 * UTC midnight, which shows as the previous day west of Greenwich, so everything here works in
 * UTC on purpose.
 */

const MS_PER_DAY = 86_400_000

/**
 * A non-leap year for days of year that belong to no one year, such as an average over several
 * years or a chart's month lines, so they read the same whichever year is selected.
 */
export const REFERENCE_YEAR = 2023

/** Parses YYYY-MM-DD as a UTC date, or returns null for anything else. */
export function parseIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  const [, y, m, d] = match.map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null
}

/** Day of year, 1-366. */
export function dayOfYear(iso: string): number {
  const date = parseIsoDate(iso)
  if (!date) throw new Error(`Not a calendar date: ${iso}`)
  return Math.round((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / MS_PER_DAY) + 1
}

/** The calendar date of a day of year, as YYYY-MM-DD. */
export function dateFromDayOfYear(year: number, doy: number): string {
  return new Date(Date.UTC(year, 0, doy)).toISOString().slice(0, 10)
}

const longFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const dayMonthFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

/** "11 Apr 2021". */
export function formatDate(iso: string): string {
  const date = parseIsoDate(iso)
  return date ? longFormat.format(date) : iso
}

/** "11 Apr", for axes and compact labels. */
export function formatDayMonth(iso: string): string {
  const date = parseIsoDate(iso)
  return date ? dayMonthFormat.format(date) : iso
}
