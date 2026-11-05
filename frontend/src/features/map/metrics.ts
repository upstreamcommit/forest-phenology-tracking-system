import type { GridPointProperties } from '../../api/types'
import { dateFromDayOfYear, dayOfYear, formatDayMonth } from '../../lib/dates'
import { formatDays } from '../../lib/format'

export type MetricKey = 'season_length' | 'sos' | 'eos' | 'forest'

export type Domain = readonly [number, number]

interface MetricBase {
  key: MetricKey
  label: string
  /** One sentence for screen readers and tooltips. */
  description: string
  /** Unit of the raw value: days, day of year, or none for the forest flag. */
  unit: 'days' | 'day of year' | ''
  /** The raw value for a grid point: days, a day of year (1-366), or 1/0 for forest. */
  value: (point: GridPointProperties) => number | null
  /**
   * The value as people read it: "193 days", "11 Apr", "Forest". Days of year become dates in
   * `year`, which matters only for the day after 28 February in leap years.
   */
  format: (value: number | null, year?: number) => string
}

export type MetricDefinition =
  | (MetricBase & {
      kind: 'sequential'
      /** The value range the colour scale spans, the same in every year. */
      domain: Domain
    })
  | (MetricBase & { kind: 'categorical' })

/**
 * Fixed colour ranges for the numeric metrics. One range for every year keeps a colour meaning the
 * same value whichever year is shown, so the map shows year-to-year change. They cover every
 * stored value of the synthetic seed, 2016-2026 (start of season on day 72-131, end on day
 * 267-312, length 139-236 days), with a little headroom; values outside are drawn in the colour
 * of the nearer end.
 */
export const COLOUR_DOMAINS = {
  season_length: [120, 240],
  sos: [70, 135],
  eos: [260, 315],
} as const satisfies Record<string, Domain>

const NO_DATA = 'No data'
/** A non-leap year, for days of year that have no particular year. */
export const REFERENCE_YEAR = 2023

function formatDayOfYear(doy: number | null, year = REFERENCE_YEAR): string {
  if (doy === null || !Number.isFinite(doy)) return NO_DATA
  return formatDayMonth(dateFromDayOfYear(year, Math.round(doy)))
}

function doyOf(iso: string | null): number | null {
  if (iso === null) return null
  try {
    return dayOfYear(iso)
  } catch {
    return null
  }
}

export const METRICS: Record<MetricKey, MetricDefinition> = {
  season_length: {
    key: 'season_length',
    label: 'Season length',
    description: 'Number of days between the start and the end of the growing season.',
    unit: 'days',
    kind: 'sequential',
    domain: COLOUR_DOMAINS.season_length,
    value: (p) => p.season_length,
    format: (value) => (value === null ? NO_DATA : formatDays(Math.round(value))),
  },
  sos: {
    key: 'sos',
    label: 'Start of season',
    description: 'Date the growing season starts, when greenness rises past the threshold.',
    unit: 'day of year',
    kind: 'sequential',
    domain: COLOUR_DOMAINS.sos,
    value: (p) => doyOf(p.sos_date),
    format: formatDayOfYear,
  },
  eos: {
    key: 'eos',
    label: 'End of season',
    description: 'Last date greenness is still above the threshold.',
    unit: 'day of year',
    kind: 'sequential',
    domain: COLOUR_DOMAINS.eos,
    value: (p) => doyOf(p.eos_date),
    format: formatDayOfYear,
  },
  forest: {
    key: 'forest',
    label: 'Forest',
    description: 'Whether the grid cell is classed as forest or as open land.',
    unit: '',
    kind: 'categorical',
    value: (p) => (p.is_forest ? 1 : 0),
    format: (value) => (value === null ? NO_DATA : value === 1 ? 'Forest' : 'Open land'),
  },
}

/** Display order of the metric picker. */
export const METRIC_KEYS: MetricKey[] = ['season_length', 'sos', 'eos', 'forest']

export const DEFAULT_METRIC: MetricKey = 'season_length'

export function isMetricKey(value: unknown): value is MetricKey {
  return typeof value === 'string' && (METRIC_KEYS as string[]).includes(value)
}
