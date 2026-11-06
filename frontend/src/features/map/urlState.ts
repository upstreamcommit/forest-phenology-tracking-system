import { DEFAULT_METRIC, isMetricKey, type MetricKey } from './metrics'

/** The year in the URL if it is a stored year, otherwise the latest stored year. */
export function parseYear(raw: string | null, years: readonly number[]): number | undefined {
  const year = raw === null || raw.trim() === '' ? NaN : Number(raw)
  return years.includes(year) ? year : years[years.length - 1]
}

export function parseMetric(raw: string | null): MetricKey {
  return isMetricKey(raw) ? raw : DEFAULT_METRIC
}

/**
 * A coordinate from the URL, parsed with Number so that String(number) round-trips exactly.
 * Null for a missing or non-numeric value.
 */
export function parseCoordinate(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}
