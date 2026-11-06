import type { UseQueryResult } from '@tanstack/react-query'
import { useId, type ReactNode } from 'react'

import { ApiError } from '../../api/client'
import { usePointMetric, useTimeseries } from '../../api/queries'
import type { PointMetric, Timeseries } from '../../api/types'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { StatusMessage } from '../../components/StatusMessage'
import { dayOfYear, formatDate } from '../../lib/dates'
import { describeError } from '../../lib/errors'
import { formatCoordinates, formatDays } from '../../lib/format'
import { averageSeason, seasonDays, yearRange } from '../charts/seasons'
import { TrendChart } from '../charts/TrendChart'
import { describeComparison } from './comparison'

export interface PointPanelProps {
  product: string
  /** The year selected on the map. */
  year: number
  /** Every year with stored metrics, ascending (from the catalog). */
  years: number[]
  /** Exact stored coordinates of the selected grid point. */
  lat: number
  lon: number
  /** Whether the point lies inside the NDVI raster stack (so a computed curve exists). */
  inComputedArea: boolean
  onClose: () => void
  /** Called when the user picks a year in the trend chart. */
  onSelectYear?: (year: number) => void
  /** Extra actions, such as a link to the point's detail page. */
  actions?: ReactNode
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'not_found'
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return <Button onClick={onRetry}>Try again</Button>
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}

function Stat({ label, value, detail }: { label: string; value: ReactNode; detail?: string }) {
  return (
    <div className="rounded-lg bg-surface-sunken px-3 py-2">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold text-ink tabular-nums">{value}</dd>
      {detail && <dd className="text-xs text-ink-muted tabular-nums">{detail}</dd>}
    </div>
  )
}

/** The selected year's metrics, compared with the point's average once the record loads. */
function YearSummary({
  year,
  point,
  timeseries,
}: {
  year: number
  point: UseQueryResult<PointMetric>
  timeseries: Timeseries | undefined
}) {
  if (point.isPending) return <StatusMessage tone="loading" title="Loading point metrics" />
  if (point.isError) {
    if (isNotFound(point.error)) {
      return <StatusMessage tone="empty" title={`No stored metrics for this point in ${year}.`} />
    }
    return (
      <StatusMessage
        tone="error"
        title="Could not load this point"
        action={<RetryButton onRetry={() => void point.refetch()} />}
      >
        {describeError(point.error)}
      </StatusMessage>
    )
  }

  const metric = point.data
  const season = seasonDays(metric)
  const average = timeseries ? averageSeason(timeseries.metrics) : null
  const comparison = season && average && average.count > 1 ? describeComparison(season, average) : []
  const length = metric.season_length ?? season?.length

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-ink">{metric.year} season</h3>
      <dl className="grid grid-cols-2 gap-2">
        <Stat
          label="Start of season"
          value={metric.sos_date ? formatDate(metric.sos_date) : 'No data'}
          detail={metric.sos_date ? `day ${dayOfYear(metric.sos_date)}` : undefined}
        />
        <Stat
          label="End of season"
          value={metric.eos_date ? formatDate(metric.eos_date) : 'No data'}
          detail={metric.eos_date ? `day ${dayOfYear(metric.eos_date)}` : undefined}
        />
        <Stat
          label="Season length"
          value={length === null || length === undefined ? 'No data' : formatDays(length)}
        />
        <Stat
          label="Land cover"
          value={
            <Badge tone={metric.is_forest ? 'ok' : 'neutral'}>
              {metric.is_forest ? 'Forest' : 'Open land'}
            </Badge>
          }
        />
      </dl>
      {comparison.length > 0 && (
        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-ink-muted marker:text-ink-subtle">
          {comparison.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Every stored season for the point, as a chart. */
function SeasonRecord({
  series,
  year,
  onSelectYear,
  announceLoading,
}: {
  series: UseQueryResult<Timeseries>
  year: number
  onSelectYear?: (year: number) => void
  /** Off while the point itself is loading, so only one loading message is announced. */
  announceLoading: boolean
}) {
  if (series.isPending) {
    return announceLoading ? (
      <StatusMessage tone="loading" title="Loading the season record" />
    ) : null
  }
  if (series.isError) {
    // A point with no record says so in the summary above; nothing to add here.
    if (isNotFound(series.error)) return null
    return (
      <StatusMessage
        tone="error"
        title="Could not load the season record"
        action={<RetryButton onRetry={() => void series.refetch()} />}
      >
        {describeError(series.error)}
      </StatusMessage>
    )
  }

  const { metrics } = series.data
  if (metrics.length === 0) return null
  const recordYears = metrics.map((m) => m.year)
  return (
    <TrendChart
      metrics={metrics}
      highlightYear={year}
      onSelectYear={onSelectYear}
      title={`Season timing, ${yearRange(Math.min(...recordYears), Math.max(...recordYears))}`}
    />
  )
}

/** Stored metrics for one grid point: the selected year, its trend across years, and actions. */
export function PointPanel({
  product,
  year,
  years,
  lat,
  lon,
  inComputedArea,
  onClose,
  onSelectYear,
  actions,
}: PointPanelProps) {
  const eyebrowId = useId()
  const headingId = useId()
  const hasYears = years.length > 0

  const point = usePointMetric({ product, year, lat, lon })
  const series = useTimeseries(
    hasYears
      ? { product, lat, lon, startYear: years[0], endYear: years[years.length - 1] }
      : undefined,
  )

  return (
    <section
      aria-labelledby={`${eyebrowId} ${headingId}`}
      className="flex flex-col gap-4 bg-surface p-4 text-sm text-ink"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p id={eyebrowId} className="text-xs font-medium tracking-wide text-ink-subtle uppercase">
            Selected point
          </p>
          <h2 id={headingId} className="text-base font-semibold text-ink tabular-nums">
            {formatCoordinates(lat, lon)}
          </h2>
        </div>
        <Button
          variant="ghost"
          aria-label="Close point details"
          onClick={onClose}
          className="-mt-1 -mr-2"
        >
          <CloseIcon />
        </Button>
      </header>

      <YearSummary year={year} point={point} timeseries={series.data} />

      {hasYears && (
        <SeasonRecord
          series={series}
          year={year}
          onSelectYear={onSelectYear}
          announceLoading={!point.isPending}
        />
      )}

      {inComputedArea && (
        <p className="rounded-md bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
          A computed NDVI curve is available for this point.
        </p>
      )}

      {actions && <div className="flex flex-wrap gap-2 border-t border-line pt-3">{actions}</div>}
    </section>
  )
}
