import type { BBox, GridResponse, StoredCoverage } from '../../api/types'
import { METRICS } from './metrics'

/**
 * What each map cell carries. lat and lon are the stored coordinates exactly as the API sent
 * them: the API matches points by exact float equality, so they must never be rounded.
 */
export type CellProperties = {
  lat: number
  lon: number
  season_length: number | null
  /** Start of season as a day of year. */
  sos: number | null
  /** End of season as a day of year. */
  eos: number | null
  /** 1 for forest, 0 for open land. */
  forest: number | null
}

export type CellFeature = {
  type: 'Feature'
  /** The feature's index in the collection, for MapLibre feature-state. */
  id: number
  geometry: { type: 'Polygon'; coordinates: [number, number][][] }
  properties: CellProperties
}

export type CellCollection = {
  type: 'FeatureCollection'
  features: CellFeature[]
}

export const EMPTY_CELLS: CellCollection = { type: 'FeatureCollection', features: [] }

const FALLBACK_STEP_DEG = 0.1

/**
 * The spacing of the stored grid: the catalog's grid_step_deg when it gives one, otherwise the
 * smallest gap between stored longitudes, otherwise 0.1 degree.
 */
export function resolveGridStep(
  stored: StoredCoverage | null | undefined,
  grid?: GridResponse,
): number {
  const step = stored?.grid_step_deg
  if (typeof step === 'number' && Number.isFinite(step) && step > 0) return step

  const lons = [...new Set(grid?.features.map((f) => f.geometry.coordinates[0]))].sort(
    (a, b) => a - b,
  )
  let smallest = Infinity
  for (let i = 1; i < lons.length; i++) {
    const gap = lons[i] - lons[i - 1]
    // Skip float noise between coordinates that are the same longitude on paper.
    if (gap > 1e-9) smallest = Math.min(smallest, gap)
  }
  return Number.isFinite(smallest) ? smallest : FALLBACK_STEP_DEG
}

/** One square polygon per stored point, `step` degrees wide and centred on the point. */
export function buildCells(grid: GridResponse, step: number): CellCollection {
  const half = step / 2
  const features = grid.features.map((feature, index): CellFeature => {
    const [lon, lat] = feature.geometry.coordinates
    const p = feature.properties
    return {
      type: 'Feature',
      id: index,
      geometry: {
        type: 'Polygon',
        // Counter-clockwise exterior ring, as RFC 7946 asks.
        coordinates: [
          [
            [lon - half, lat - half],
            [lon + half, lat - half],
            [lon + half, lat + half],
            [lon - half, lat + half],
            [lon - half, lat - half],
          ],
        ],
      },
      properties: {
        lat,
        lon,
        season_length: METRICS.season_length.value(p),
        sos: METRICS.sos.value(p),
        eos: METRICS.eos.value(p),
        forest: METRICS.forest.value(p),
      },
    }
  })
  return { type: 'FeatureCollection', features }
}

/** Width of a cell, read back from its polygon. */
function cellWidth(feature: CellFeature): number {
  const ring = feature.geometry.coordinates[0]
  return ring[1][0] - ring[0][0]
}

/**
 * The cell whose stored point is nearest to (lat, lon), measured in degrees so the answer is the
 * cell drawn around the point. Null when no stored point lies within one grid step on both
 * axes: the query is off the grid or in a gap of it.
 */
export function findNearestCell(
  cells: CellCollection,
  lat: number,
  lon: number,
): CellFeature | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || cells.features.length === 0) return null

  let best: CellFeature | null = null
  let bestDistance = Infinity
  for (const feature of cells.features) {
    const dLat = feature.properties.lat - lat
    const dLon = feature.properties.lon - lon
    const distance = dLat * dLat + dLon * dLon
    if (distance < bestDistance) {
      best = feature
      bestDistance = distance
    }
  }
  if (!best) return null

  const limit = cellWidth(best) + 1e-9
  const tooFar =
    Math.abs(best.properties.lat - lat) > limit || Math.abs(best.properties.lon - lon) > limit
  return tooFar ? null : best
}

/** The cell stored at exactly (lat, lon), or null. */
export function findCellAt(cells: CellCollection, lat: number, lon: number): CellFeature | null {
  return cells.features.find((f) => f.properties.lat === lat && f.properties.lon === lon) ?? null
}

/** Whether a point lies inside [min_lon, min_lat, max_lon, max_lat], edges included. */
export function isInBBox(lat: number, lon: number, bbox: BBox | null | undefined): boolean {
  if (!bbox) return false
  const [minLon, minLat, maxLon, maxLat] = bbox
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat
}
