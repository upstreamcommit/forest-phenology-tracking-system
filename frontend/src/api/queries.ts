import { keepPreviousData, QueryClient, useQuery } from '@tanstack/react-query'

import { ApiError } from './client'
import {
  getCatalog,
  getGrid,
  getHealth,
  getNdviCurve,
  getPointMetric,
  getTimeseries,
  type PointQuery,
} from './endpoints'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A 4xx is an answer, not a glitch; retry other failures once.
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.isClientError) && failureCount < 1,
        refetchOnWindowFocus: false,
        staleTime: 60_000,
      },
    },
  })
}

export const queryKeys = {
  health: ['health'] as const,
  catalog: ['catalog'] as const,
  grid: (product: string, year: number) => ['grid', product, year] as const,
  point: (q: PointQuery) => ['point', q.product, q.year, q.lat, q.lon] as const,
  timeseries: (product: string, lat: number, lon: number, startYear: number, endYear: number) =>
    ['timeseries', product, lat, lon, startYear, endYear] as const,
  ndviCurve: (q: PointQuery, thresholdFrac: number | undefined) =>
    ['ndvi-curve', q.product, q.year, q.lat, q.lon, thresholdFrac ?? null] as const,
}

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => getHealth(signal),
    refetchInterval: 30_000,
    retry: false,
  })
}

/** Which products, years and extents exist. Changes only when the data is reseeded. */
export function useCatalog() {
  return useQuery({
    queryKey: queryKeys.catalog,
    queryFn: ({ signal }) => getCatalog(signal),
    staleTime: 5 * 60_000,
  })
}

/** Every stored grid point for one product and year. Keeps the previous year on screen while a
 * new one loads, so the map doesn't flash empty when the year changes. */
export function useGrid(product: string | undefined, year: number | undefined) {
  return useQuery({
    queryKey: queryKeys.grid(product ?? '', year ?? 0),
    queryFn: ({ signal }) => getGrid({ product: product!, year: year! }, signal),
    enabled: product !== undefined && year !== undefined,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  })
}

/** The stored metric for one point and year (mode=repo). */
export function usePointMetric(q: PointQuery | undefined) {
  return useQuery({
    queryKey: q ? queryKeys.point(q) : ['point', 'none'],
    queryFn: ({ signal }) => getPointMetric({ ...q!, mode: 'repo' }, signal),
    enabled: q !== undefined,
  })
}

export function useTimeseries(
  q: { product: string; lat: number; lon: number; startYear: number; endYear: number } | undefined,
) {
  return useQuery({
    queryKey: q
      ? queryKeys.timeseries(q.product, q.lat, q.lon, q.startYear, q.endYear)
      : ['timeseries', 'none'],
    queryFn: ({ signal }) => getTimeseries(q!, signal),
    enabled: q !== undefined,
  })
}

export function useNdviCurve(q: PointQuery | undefined, thresholdFrac?: number) {
  return useQuery({
    queryKey: q ? queryKeys.ndviCurve(q, thresholdFrac) : ['ndvi-curve', 'none'],
    queryFn: ({ signal }) => getNdviCurve({ ...q!, thresholdFrac }, signal),
    enabled: q !== undefined,
    placeholderData: keepPreviousData,
  })
}
