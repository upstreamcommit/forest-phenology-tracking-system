import type { UseQueryResult } from '@tanstack/react-query'
import { useId, type ReactNode } from 'react'

import type { PointMetric, Timeseries } from '../../api/types'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { StatusMessage } from '../../components/StatusMessage'
import { dayOfYear, formatDate } from '../../lib/dates'
import { describeError } from '../../lib/errors'
import { formatDays } from '../../lib/format'
import { averageSeason, seasonDays, yearRange } from '../charts/seasons'
import { TrendChart } from '../charts/TrendChart'
import { describeComparison } from '../point-panel/comparison'
import { isNotFound } from './queryState'

export interface StoredSeasonSectionProps {
  year: number
  /** The stored metric for the year. A 404 means the point is not a stored grid point. */
  point: UseQueryResult<PointMetric>
  /** Every stored year for the point. */
  series: UseQueryResult<Timeseries>
  /** Spacing of the stored grid in degrees, when the catalog gives it. */
  gridStep: number | null
  onSelectYear: (year: number) => void
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

function YearSeason({ metric, series }: { metric: PointMetric; series: Timeseries | undefined }) {
  const season = seasonDays(metric)
  const average = series ? averageSeason(series.metrics) : null
  const comparison =
    season && average && average.count > 1 ? describeComparison(season, average) : []
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
        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-ink-muted marker:text-ink-subtle">
          {comparison.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SeasonRecord({
  series,
  year,
  onSelectYear,
  announceLoading,
}: {
  series: UseQueryResult<Timeseries>
  year: number
  onSelectYear: (year: number) => void
  /** Off while the year itself is loading, so only one loading message is announced. */
  announceLoading: boolean
}) {
  if (series.isPending) {
    return announceLoading ? (
      <StatusMessage tone="loading" title="Loading the season record" />
    ) : null
  }
  if (series.isError) {
    if (isNotFound(series.error)) return null
    return (
      <StatusMessage
        tone="error"
        title="Could not load the season record"
        action={<Button onClick={() => void series.refetch()}>Try again</Button>}
      >
        {describeError(series.error)}
      </StatusMessage>
    )
  }

  const { metrics } = series.data
  if (metrics.length === 0) return null
  const years = metrics.map((m) => m.year)
  return (
    <TrendChart
      metrics={metrics}
      highlightYear={year}
      onSelectYear={onSelectYear}
      title={`Season timing, ${yearRange(Math.min(...years), Math.max(...years))}`}
    />
  )
}

/** Precomputed metrics: the selected year against the point's average, and every stored year. */
export function StoredSeasonSection({
  year,
  point,
  series,
  gridStep,
  onSelectYear,
}: StoredSeasonSectionProps) {
  const headingId = useId()
  const grid = gridStep ? `stored ${gridStep}° grid` : 'stored grid'
  const offGrid = point.isError && isNotFound(point.error)

  let summary: ReactNode
  if (point.isPending) {
    summary = <StatusMessage tone="loading" title="Loading the stored season" />
  } else if (offGrid) {
    summary = (
      <StatusMessage tone="info" title={`This location is not on the ${grid}`}>
        Stored metrics exist only for the grid points drawn as cells on the map. Pick a cell there
        to see them.
      </StatusMessage>
    )
  } else if (point.isError) {
    summary = (
      <StatusMessage
        tone="error"
        title="Could not load the stored season"
        action={<Button onClick={() => void point.refetch()}>Try again</Button>}
      >
        {describeError(point.error)}
      </StatusMessage>
    )
  } else {
    summary = <YearSeason metric={point.data} series={series.data} />
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface p-4"
    >
      <div>
        <h2 id={headingId} className="text-base font-semibold text-ink">
          Stored season
        </h2>
        <p className="mt-0.5 text-sm text-ink-muted">
          Precomputed start, end and length of the growing season on the {grid}.
        </p>
      </div>
      {summary}
      {!offGrid && (
        <SeasonRecord
          series={series}
          year={year}
          onSelectYear={onSelectYear}
          announceLoading={!point.isPending}
        />
      )}
    </section>
  )
}
