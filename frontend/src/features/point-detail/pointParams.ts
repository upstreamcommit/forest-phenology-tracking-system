import type { BBox, Product, StoredCoverage } from '../../api/types'
import { resolveGridStep } from '../map/gridLayer'
import { parseCoordinate } from '../map/urlState'

export interface Location {
  lat: number
  lon: number
}

/** The slider's range for the season threshold, as a fraction of the seasonal amplitude. */
export const THRESHOLD_MIN = 0.05
export const THRESHOLD_MAX = 0.95
export const THRESHOLD_STEP = 0.05

/** Latitude and longitude from the path, or null unless both are numbers on the globe. */
export function parseLocation(
  rawLat: string | undefined,
  rawLon: string | undefined,
): Location | null {
  const lat = parseCoordinate(rawLat ?? null)
  const lon = parseCoordinate(rawLon ?? null)
  if (lat === null || lon === null) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

/**
 * A threshold fraction on the slider: in its 5% steps and within its range, to two decimals,
 * so 0.6000000000000001 becomes 0.6, 0.33 becomes 0.35 and 0.02 becomes 0.05.
 */
export function snapThreshold(value: number): number {
  const snapped = Math.round(Math.round(value / THRESHOLD_STEP) * THRESHOLD_STEP * 100) / 100
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, snapped))
}

/**
 * The threshold in the URL when strictly between 0 and 1, snapped to the slider, so the slider,
 * its label and the request all use one value.
 */
export function parseThreshold(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 && value < 1 ? snapThreshold(value) : fallback
}

/** "50%", for a threshold fraction. */
export function formatThreshold(frac: number): string {
  return `${Math.round(frac * 100)}%`
}

/** The product the map shows: the first one with stored metrics. */
export function findStoredProduct(products: readonly Product[]): Product | undefined {
  return products.find((p) => (p.stored?.years.length ?? 0) > 0)
}

function formatDegrees(value: number, positive: string, negative: string): string {
  return `${Math.abs(value)}° ${value < 0 ? negative : positive}`
}

/** "latitude 50.995° N to 52.005° N, longitude 1.005° W to 0.005° E", unrounded. */
export function describeArea([minLon, minLat, maxLon, maxLat]: BBox): string {
  const lat = `${formatDegrees(minLat, 'N', 'S')} to ${formatDegrees(maxLat, 'N', 'S')}`
  const lon = `${formatDegrees(minLon, 'E', 'W')} to ${formatDegrees(maxLon, 'E', 'W')}`
  return `latitude ${lat}, longitude ${lon}`
}

/** How many decimals `value` needs: 1 for 0.1, 2 for 0.25. */
function decimalsOf(value: number): number {
  for (let decimals = 0; decimals < 10; decimals++) {
    if (Math.abs(Number(value.toFixed(decimals)) - value) < 1e-12) return decimals
  }
  return 10
}

/**
 * The stored grid point nearest the centre of `area`, such as the middle of the area with NDVI
 * curves. Rounded to the decimals of the grid's origin and step, the way grid coordinates are
 * stored, so 51.5 rather than 51.50000000000001.
 */
export function gridPointNearCentre(area: BBox, stored: StoredCoverage): Location {
  const step = resolveGridStep(stored)
  const snap = (centre: number, origin: number) => {
    const decimals = Math.max(decimalsOf(step), decimalsOf(origin))
    const value = origin + Math.round((centre - origin) / step) * step
    // `|| 0` turns -0 into 0.
    return Number(value.toFixed(decimals)) || 0
  }
  const [minLon, minLat, maxLon, maxLat] = area
  const [originLon, originLat] = stored.bbox
  return {
    lat: snap((minLat + maxLat) / 2, originLat),
    lon: snap((minLon + maxLon) / 2, originLon),
  }
}
