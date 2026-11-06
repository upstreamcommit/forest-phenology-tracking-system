/**
 * Links between the map and the point detail page. Coordinates go into URLs with String(), which
 * round-trips doubles exactly, so a stored grid point is looked up with its stored value.
 */

/** "/point/51.5/-0.5?year=2022". */
export function pointDetailPath(lat: number, lon: number, year?: number): string {
  const path = `/point/${String(lat)}/${String(lon)}`
  return year === undefined ? path : `${path}?year=${year}`
}

/** The map with this point selected: "/?year=2022&lat=51.5&lon=-0.5". */
export function mapPath(lat: number, lon: number, year: number): string {
  const params = new URLSearchParams({ year: String(year), lat: String(lat), lon: String(lon) })
  return `/?${params}`
}
