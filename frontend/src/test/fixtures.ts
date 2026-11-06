/**
 * Small, typed stand-ins for API responses, shaped like the real synthetic data. Shared by the
 * MSW handlers (unit tests) and the Playwright route mocks (e2e).
 */
import type {
  Catalog,
  GridFeature,
  GridResponse,
  NdviCurve,
  PointMetric,
  Timeseries,
  YearMetric,
} from '../api/types'
import { dateFromDayOfYear, dayOfYear } from '../lib/dates'

export const PRODUCT = 'ndvi_synth'
export const YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]

export const catalog: Catalog = {
  default_threshold_frac: 0.5,
  products: [
    {
      id: PRODUCT,
      label: 'Synthetic NDVI',
      description: 'Generated demonstration data. It is not derived from satellite observations.',
      synthetic: true,
      stored: { years: YEARS, bbox: [-7.5, 49.5, 2.0, 59.0], grid_step_deg: 0.1 },
      computed: { years: YEARS, bbox: [-1.005, 50.995, 0.005, 52.005], pixel_size_deg: 0.01 },
    },
  ],
}

/** A deterministic season for a grid point and year, varying with place and year. */
export function seasonAt(lat: number, lon: number, year: number) {
  const sos = Math.round(96 + 2.6 * (lat - 52) - lon + (year - 2016) * -0.4 + (year === 2021 ? 8 : 0))
  const eos = Math.round(292 - 2 * (lat - 52) + lon + (year === 2022 ? -16 : 0))
  return {
    sos_date: dateFromDayOfYear(year, sos),
    eos_date: dateFromDayOfYear(year, eos),
    season_length: eos - sos,
    is_forest: Math.round(lat * 10 + lon * 10) % 3 === 0,
  }
}

/** Grid points every 0.1 degree over lon -1.0..0.0, lat 51.0..52.0 (the stack overlap). */
export const GRID_POINTS: [number, number][] = []
for (let i = 0; i <= 10; i++) {
  for (let j = 0; j <= 10; j++) {
    GRID_POINTS.push([Math.round((-1.0 + j * 0.1) * 10) / 10, Math.round((51.0 + i * 0.1) * 10) / 10])
  }
}

export function gridFor(year: number): GridResponse {
  const features: GridFeature[] = GRID_POINTS.map(([lon, lat]) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: seasonAt(lat, lon, year),
  }))
  return { type: 'FeatureCollection', product: PRODUCT, year, requested_bbox: null, features }
}

export function pointFor(lat: number, lon: number, year: number): PointMetric {
  return { year, location: { lat, lon }, ...seasonAt(lat, lon, year) }
}

export function timeseriesFor(lat: number, lon: number, startYear: number, endYear: number): Timeseries {
  const metrics: YearMetric[] = YEARS.filter((y) => y >= startYear && y <= endYear).map((year) => ({
    year,
    ...seasonAt(lat, lon, year),
  }))
  return { product: PRODUCT, location: { lat, lon }, start_year: startYear, end_year: endYear, metrics }
}

const DOYS = Array.from({ length: 23 }, (_, i) => 1 + 16 * i)

export function ndviCurveFor(lat: number, lon: number, year: number, thresholdFrac = 0.5): NdviCurve {
  // Timed by the stored season, widened by half a composite, as the real generator does, so the
  // computed dates land within one composite of the stored ones.
  const season = seasonAt(lat, lon, year)
  const sos = dayOfYear(season.sos_date) - 8
  const eos = dayOfYear(season.eos_date) + 8
  const ndvi = DOYS.map((doy) => {
    const up = 1 / (1 + Math.exp(-(doy - sos) / 9))
    const down = 1 / (1 + Math.exp(-(doy - eos) / 12))
    return Math.round((0.18 + 0.55 * (up - down)) * 1e6) / 1e6
  })
  const min = Math.min(...ndvi)
  const max = Math.max(...ndvi)
  const threshold = Math.round((min + thresholdFrac * (max - min)) * 1e6) / 1e6
  const above = DOYS.filter((_, i) => ndvi[i] >= threshold)
  const first = above[0]
  const last = above[above.length - 1]
  return {
    product: PRODUCT,
    year,
    location: { lat, lon },
    pixel: { lat, lon },
    observations: DOYS.map((doy, i) => ({ doy, date: dateFromDayOfYear(year, doy), ndvi: ndvi[i] })),
    threshold_frac: thresholdFrac,
    threshold_ndvi: threshold,
    sos_date: dateFromDayOfYear(year, first),
    eos_date: dateFromDayOfYear(year, last),
    season_length: last - first,
  }
}
