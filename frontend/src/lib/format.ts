/** "51.50° N, 0.50° W". */
export function formatCoordinates(lat: number, lon: number, decimals = 2): string {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(decimals)}° ${ns}, ${Math.abs(lon).toFixed(decimals)}° ${ew}`
}

/** "193 days", "1 day", or a dash for no value. */
export function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return '–'
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

/** A signed whole-day difference: "+4 days", "−3 days", "same day". */
export function formatDayShift(days: number): string {
  if (days === 0) return 'same day'
  const sign = days > 0 ? '+' : '−'
  return `${sign}${formatDays(Math.abs(days))}`
}
