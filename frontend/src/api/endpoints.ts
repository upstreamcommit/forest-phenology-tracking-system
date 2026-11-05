import { apiUrl, fetchJson, isRecord } from './client'
import type {
  BBox,
  Catalog,
  GridResponse,
  Health,
  NdviCurve,
  PointMetric,
  PointMode,
  Timeseries,
} from './types'

export interface PointQuery {
  product: string
  year: number
  lat: number
  lon: number
}

export function getHealth(signal?: AbortSignal): Promise<Health> {
  return fetchJson(apiUrl('/health'), { signal })
}

function isNumberList(value: unknown, length?: number): boolean {
  return (
    Array.isArray(value) &&
    (length === undefined || value.length === length) &&
    value.every((item) => typeof item === 'number')
  )
}

function isCoverage(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (isRecord(value) && isNumberList(value.years) && isNumberList(value.bbox, 4))
  )
}

/**
 * True when the catalogue has the structure the pages read without further checks: a list of
 * products, each an object with a string id and, when present, stored and computed coverage with
 * a list of years and a four-number bbox.
 */
export function isCatalog(body: unknown): body is Catalog {
  return (
    isRecord(body) &&
    Array.isArray(body.products) &&
    body.products.every(
      (product) =>
        isRecord(product) &&
        typeof product.id === 'string' &&
        isCoverage(product.stored) &&
        isCoverage(product.computed),
    )
  )
}

/** Every page reads the catalogue, so one of the wrong shape is an error, not a crash. */
export function getCatalog(signal?: AbortSignal): Promise<Catalog> {
  return fetchJson(apiUrl('/catalog'), { signal }, isCatalog)
}

export function getGrid(
  params: { product: string; year: number; bbox?: BBox },
  signal?: AbortSignal,
): Promise<GridResponse> {
  return fetchJson(
    apiUrl('/phenology/grid', {
      product: params.product,
      year: params.year,
      bbox: params.bbox?.join(','),
    }),
    { signal },
  )
}

export function getPointMetric(
  params: PointQuery & { mode?: PointMode; thresholdFrac?: number },
  signal?: AbortSignal,
): Promise<PointMetric> {
  return fetchJson(
    apiUrl('/phenology/point', {
      product: params.product,
      year: params.year,
      lat: params.lat,
      lon: params.lon,
      mode: params.mode ?? 'repo',
      threshold_frac: params.thresholdFrac,
    }),
    { signal },
  )
}

export function getTimeseries(
  params: { product: string; lat: number; lon: number; startYear: number; endYear: number },
  signal?: AbortSignal,
): Promise<Timeseries> {
  return fetchJson(
    apiUrl('/phenology/timeseries', {
      product: params.product,
      lat: params.lat,
      lon: params.lon,
      start_year: params.startYear,
      end_year: params.endYear,
    }),
    { signal },
  )
}

export function getNdviCurve(
  params: PointQuery & { thresholdFrac?: number },
  signal?: AbortSignal,
): Promise<NdviCurve> {
  return fetchJson(
    apiUrl('/phenology/point/ndvi', {
      product: params.product,
      year: params.year,
      lat: params.lat,
      lon: params.lon,
      threshold_frac: params.thresholdFrac,
    }),
    { signal },
  )
}
