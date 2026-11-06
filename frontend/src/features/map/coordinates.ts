export type Axis = 'lat' | 'lon'

const HEMISPHERE_SIGNS: Record<Axis, Record<string, number>> = {
  lat: { N: 1, S: -1 },
  lon: { E: 1, W: -1 },
}

// An optional sign, a number with '.' or ',' as decimal separator, an optional degree sign and
// an optional hemisphere letter.
const DEGREES = /^([-+−]?)\s*(\d+(?:[.,]\d*)?|[.,]\d+)\s*°?\s*([a-z]?)$/i

/**
 * Decimal degrees as people type them: "51.5", "-0.5", "51,5", "0.5 W", "51.5°N", with a
 * typographic minus too. A hemisphere letter must suit the axis (N or S for latitude, E or W for
 * longitude) and replaces the sign. Anything else is NaN.
 */
export function parseDegrees(text: string, axis: Axis): number {
  const match = DEGREES.exec(text.trim())
  if (!match) return NaN
  const [, sign, digits, letter] = match
  const value = Number(digits.replace(',', '.'))
  if (letter === '') return sign === '-' || sign === '−' ? -value : value
  const hemisphere = HEMISPHERE_SIGNS[axis][letter.toUpperCase()]
  return hemisphere === undefined || sign !== '' ? NaN : hemisphere * value
}
