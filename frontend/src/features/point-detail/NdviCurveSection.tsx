import { useId, type ReactNode } from 'react'
import { Link } from 'react-router'

import { useNdviCurve } from '../../api/queries'
import type { NdviCurve, PointMetric, Product, StoredCoverage } from '../../api/types'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { StatusMessage } from '../../components/StatusMessage'
import { formatDate } from '../../lib/dates'
import { describeError } from '../../lib/errors'
import {
  formatCoordinates,
  formatDayShift,
  formatDays,
  formatPreciseCoordinates,
} from '../../lib/format'
import { yearRange } from '../charts/seasons'
import { NdviCurveChart } from '../charts/NdviCurveChart'
import { formatNdvi, thresholdDecimals } from '../charts/ndviCurve'
import { isInBBox } from '../map/gridLayer'
import { compositeSpacing, daysBetween, describeDateShift } from './curveComparison'
import { pointDetailPath } from './paths'
import { describeArea, formatThreshold, gridPointNearCentre } from './pointParams'
import { isNoDataAnswer, isNotFound } from './queryState'
import { ThresholdControl } from './ThresholdControl'

export interface NdviCurveSectionProps {
  product: Product
  stored: StoredCoverage
  /** Stored years, ascending. */
  years: number[]
  lat: number
  lon: number
  year: number
  /** The selected threshold, as a fraction of the seasonal amplitude. */
  threshold: number
  defaultThreshold: number
  onThresholdChange: (value: number) => void
  onThresholdReset: () => void
  /** The stored metric for the same point and year, when there is one. */
  storedMetric: PointMetric | undefined
}

const linkClass = 'font-medium text-accent underline hover:text-accent-hover'

/** Why there is no curve here, and where to find one. */
function NoCurve({
  product,
  stored,
  years,
  lat,
  lon,
  year,
}: Pick<NdviCurveSectionProps, 'product' | 'stored' | 'years' | 'lat' | 'lon' | 'year'>) {
  const computed = product.computed
  if (!computed || computed.years.length === 0) {
    return (
      <StatusMessage tone="info" title="No NDVI curves for this dataset">
        {product.label} has no NDVI stack to compute curves from.
      </StatusMessage>
    )
  }

  const computedYears = [...computed.years].sort((a, b) => a - b)
  const covered = yearRange(computedYears[0], computedYears[computedYears.length - 1])
  if (isInBBox(lat, lon, computed.bbox)) {
    return (
      <StatusMessage tone="info" title={`No NDVI curve for ${year}`}>
        NDVI curves here cover {covered}. Pick one of those years to see the curve.
      </StatusMessage>
    )
  }

  const example = gridPointNearCentre(computed.bbox, stored)
  const exampleYear = computedYears.includes(year)
    ? year
    : computedYears.filter((y) => years.includes(y)).at(-1)
  return (
    <StatusMessage
      tone="info"
      title="No NDVI curve for this location"
      action={
        <Link to={pointDetailPath(example.lat, example.lon, exampleYear)} className={linkClass}>
          Open an example point inside the area ({formatCoordinates(example.lat, example.lon)})
        </Link>
      }
    >
      NDVI curves exist only inside the area outlined on the map: {describeArea(computed.bbox)},
      for {covered}.
    </StatusMessage>
  )
}

/** Why a curve has no threshold: the API leaves it out only for an empty or flat series. */
function noThresholdReason(curve: NdviCurve): string {
  return curve.observations.length === 0
    ? 'This pixel has no NDVI values for the year'
    : 'This NDVI series is flat'
}

function ThresholdExplanation({
  id,
  frac,
  curve,
}: {
  id: string
  frac: number
  /** The curve on screen, undefined before it loads. */
  curve: NdviCurve | undefined
}) {
  const spacing = curve ? compositeSpacing(curve.observations) : 16
  const thresholdNdvi = curve?.threshold_ndvi
  return (
    <p id={id} className="text-sm text-ink-muted">
      The season starts at the first {spacing}-day composite whose NDVI reaches the threshold and
      ends at the last one. The threshold is the year&apos;s lowest NDVI plus{' '}
      {formatThreshold(frac)} of the seasonal amplitude (highest minus lowest NDVI)
      {curve && typeof thresholdNdvi === 'number' && (
        <>: NDVI {formatNdvi(thresholdNdvi, thresholdDecimals(curve))} here</>
      )}
      .
      {curve && thresholdNdvi === null && (
        <> {noThresholdReason(curve)}, so no threshold finds a season.</>
      )}
    </p>
  )
}

function ShiftItem({
  edge,
  computed,
  stored,
}: {
  edge: 'start' | 'end'
  computed: string
  stored: string
}) {
  const text = describeDateShift(edge, computed, stored)
  const days = daysBetween(stored, computed)
  if (text === null || days === null) return null
  return (
    <li className="flex items-baseline gap-2">
      <span
        aria-hidden="true"
        className="w-16 shrink-0 text-right text-xs font-semibold tabular-nums text-ink"
      >
        {formatDayShift(days)}
      </span>
      <span>
        {text} ({formatDate(stored)}).
      </span>
    </li>
  )
}

/** The computed season, set against the stored one when both exist. */
function CurveSeason({
  curve,
  stored,
  defaultThreshold,
}: {
  curve: NdviCurve
  stored: PointMetric | null
  defaultThreshold: number
}) {
  // The API finds no season only in an empty or flat series, whatever the threshold.
  if (!curve.sos_date || !curve.eos_date) {
    return <p className="text-sm text-ink">Computed season: none.</p>
  }

  const length = curve.season_length ?? daysBetween(curve.sos_date, curve.eos_date)
  const computedText = (
    <p className="text-sm text-ink">
      Computed season: {formatDate(curve.sos_date)} to {formatDate(curve.eos_date)}
      {length !== null && <>, {formatDays(length)}</>}.
    </p>
  )
  if (!stored || (!stored.sos_date && !stored.eos_date)) return computedText

  return (
    <div className="flex flex-col gap-2">
      {computedText}
      <ul className="flex flex-col gap-1 text-sm text-ink-muted">
        {stored.sos_date && (
          <ShiftItem edge="start" computed={curve.sos_date} stored={stored.sos_date} />
        )}
        {stored.eos_date && (
          <ShiftItem edge="end" computed={curve.eos_date} stored={stored.eos_date} />
        )}
      </ul>
      {/* Stored seasons exist only for the default threshold. */}
      <p className="text-xs text-ink-muted">
        {curve.threshold_frac === defaultThreshold ? (
          <>
            Composites are {compositeSpacing(curve.observations)} days apart, so computed and
            stored dates can differ by up to about one composite.
          </>
        ) : (
          <>
            Stored seasons are derived at the default threshold of{' '}
            {formatThreshold(defaultThreshold)}, so at {formatThreshold(curve.threshold_frac)} this
            is not a like-for-like comparison.
          </>
        )}
      </p>
    </div>
  )
}

/** The curve for a point inside the computed area, with the threshold control. */
function CurveView({
  product,
  lat,
  lon,
  year,
  threshold,
  defaultThreshold,
  onThresholdChange,
  onThresholdReset,
  storedMetric,
}: Omit<NdviCurveSectionProps, 'stored' | 'years'>) {
  const explanationId = useId()
  const curve = useNdviCurve({ product: product.id, year, lat, lon }, threshold)
  const data = curve.data
  const updating = curve.isFetching && curve.isPlaceholderData
  // While a new year loads, the stored metric can belong to a different year than the curve.
  const storedForYear = data && storedMetric?.year === data.year ? storedMetric : null

  let body: ReactNode
  let showControl = true
  if (curve.isError) {
    if (isNoDataAnswer(curve.error)) {
      showControl = false
      const title = isNotFound(curve.error)
        ? `No NDVI curve for ${year}`
        : 'No NDVI curve at this point'
      body = (
        <StatusMessage tone="info" title={title}>
          {describeError(curve.error)}
        </StatusMessage>
      )
    } else {
      body = (
        <StatusMessage
          tone="error"
          title="Could not load the NDVI curve"
          action={<Button onClick={() => void curve.refetch()}>Try again</Button>}
        >
          {describeError(curve.error)}
        </StatusMessage>
      )
    }
  } else if (!data) {
    body = <StatusMessage tone="loading" title="Loading the NDVI curve" />
  } else {
    body = (
      <>
        <NdviCurveChart
          curve={data}
          stored={
            storedForYear && { sos_date: storedForYear.sos_date, eos_date: storedForYear.eos_date }
          }
          title={`NDVI through ${data.year} at ${formatPreciseCoordinates(lat, lon)}`}
        />
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-xs text-ink-muted">
            Sampled at the NDVI pixel centred on{' '}
            {formatCoordinates(data.pixel.lat, data.pixel.lon, 3)}.
          </p>
          {/* The previous curve stays on screen while the next loads; this says so. */}
          <div role="status">{updating && <Spinner label="Updating" />}</div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-2">{body}</div>
      {showControl && (
        <div className="flex flex-col gap-2">
          <ThresholdControl
            value={threshold}
            defaultValue={defaultThreshold}
            onChange={onThresholdChange}
            onReset={onThresholdReset}
            describedBy={explanationId}
          />
          <ThresholdExplanation
            id={explanationId}
            frac={data?.threshold_frac ?? threshold}
            curve={data}
          />
        </div>
      )}
      {data && !curve.isError && (
        <CurveSeason curve={data} stored={storedForYear} defaultThreshold={defaultThreshold} />
      )}
    </>
  )
}

/** The NDVI curve computed for the point, where the raster stack covers it. */
export function NdviCurveSection(props: NdviCurveSectionProps) {
  const headingId = useId()
  const { product, lat, lon, year } = props
  const computed = product.computed
  const available = !!computed && isInBBox(lat, lon, computed.bbox) && computed.years.includes(year)

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface p-4"
    >
      <div>
        <h2 id={headingId} className="text-base font-semibold text-ink">
          NDVI curve
        </h2>
        <p className="mt-0.5 text-sm text-ink-muted">
          Greenness through the year at the nearest NDVI pixel, and the season computed from it on
          request.
        </p>
      </div>
      {available ? <CurveView {...props} /> : <NoCurve {...props} />}
    </section>
  )
}
