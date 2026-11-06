/** "51.50° N, 0.50° W". */
export function formatCoordinates(lat: number, lon: number, decimals = 2): string {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(decimals)}° ${ns}, ${Math.abs(lon).toFixed(decimals)}° ${ew}`
}

const MAX_DECIMALS = 5

/** The decimals that show `value` unrounded, from `min` up to MAX_DECIMALS. */
function decimalsFor(value: number, min: number): number {
  let decimals = min
  while (decimals < MAX_DECIMALS && Math.abs(Number(value.toFixed(decimals)) - value) > 1e-9) {
    decimals++
  }
  return decimals
}

/**
 * Coordinates with the decimals they need, 2 to 5, so nearby points get different names:
 * "51.50° N, 0.50° W", but "51.495° N, 0.495° W" rather than "51.49° N, 0.49° W".
 */
export function formatPreciseCoordinates(lat: number, lon: number): string {
  return formatCoordinates(lat, lon, Math.max(decimalsFor(lat, 2), decimalsFor(lon, 2)))
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
