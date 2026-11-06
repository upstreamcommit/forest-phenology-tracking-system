import type { UseQueryResult } from '@tanstack/react-query'
import { useCallback, useMemo, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'

import { useCatalog, usePointMetric, useTimeseries } from '../../api/queries'
import type { Product, StoredCoverage, Timeseries } from '../../api/types'
import { Badge } from '../../components/Badge'
import { PageTitle } from '../../components/PageTitle'
import { Button } from '../../components/Button'
import { StatusMessage } from '../../components/StatusMessage'
import { describeError } from '../../lib/errors'
import { formatPreciseCoordinates } from '../../lib/format'
import { yearRange } from '../charts/seasons'
import { isInBBox } from '../map/gridLayer'
import { parseYear } from '../map/urlState'
import { YearSlider } from '../map/YearSlider'
import { NdviCurveSection } from './NdviCurveSection'
import { mapPath } from './paths'
import { findStoredProduct, parseLocation, parseThreshold, type Location } from './pointParams'
import { isNotFound } from './queryState'
import { StoredSeasonSection } from './StoredSeasonSection'

const linkClass = 'font-medium text-accent underline hover:text-accent-hover'

function PageMessage({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-xl px-4 py-12">{children}</div>
}

function InvalidLocation() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16">
      <h1 tabIndex={-1} className="text-2xl font-semibold text-ink outline-none">
        Not a valid location
      </h1>
      <p className="mt-2 text-ink-muted">
        This address does not name a point on the globe. Latitude must be a number from −90 to
        90 and longitude a number from −180 to 180.
      </p>
      <Link to="/" className={`mt-6 inline-block ${linkClass}`}>
        Back to the map
      </Link>
    </div>
  )
}

/** Details of one location: its stored season and, inside the computed area, its NDVI curve. */
export function PointDetailPage() {
  const params = useParams()
  const location = parseLocation(params.lat, params.lon)
  const name = location
    ? formatPreciseCoordinates(location.lat, location.lon)
    : 'Not a valid location'

  return (
    <>
      <PageTitle>{name}</PageTitle>
      {location ? (
        // A new location starts afresh, scrolled to the top.
        <CatalogGate key={`${location.lat},${location.lon}`} location={location} />
      ) : (
        <InvalidLocation />
      )}
    </>
  )
}

function CatalogGate({ location }: { location: Location }) {
  const catalog = useCatalog()

  if (catalog.isPending) {
    return (
      <PageMessage>
        <StatusMessage tone="loading" title="Loading the list of datasets" />
      </PageMessage>
    )
  }
  if (catalog.isError) {
    return (
      <PageMessage>
        <StatusMessage
          tone="error"
          title="Could not load the list of datasets"
          action={<Button onClick={() => void catalog.refetch()}>Try again</Button>}
        >
          {describeError(catalog.error)}
        </StatusMessage>
      </PageMessage>
    )
  }

  const product = findStoredProduct(catalog.data.products)
  if (!product?.stored) {
    return (
      <PageMessage>
        <StatusMessage
          tone="empty"
          title="No stored metrics to show"
          action={
            <Link to="/" className={linkClass}>
              Back to the map
            </Link>
          }
        >
          The API lists no product with stored phenology metrics.
        </StatusMessage>
      </PageMessage>
    )
  }
  return (
    <PointDetail
      product={product}
      stored={product.stored}
      defaultThreshold={catalog.data.default_threshold_frac}
      {...location}
    />
  )
}

function storedAvailability(series: UseQueryResult<Timeseries>, grid: string): string {
  if (series.isPending) return 'Checking…'
  if (series.isError) {
    return isNotFound(series.error) ? `No, not on the ${grid}` : 'Could not be checked'
  }
  const years = series.data.metrics.map((m) => m.year)
  if (years.length === 0) return `No, not on the ${grid}`
  return `Yes, ${yearRange(Math.min(...years), Math.max(...years))}`
}

function computedAvailability(product: Product, lat: number, lon: number, year: number): string {
  const computed = product.computed
  if (!computed || computed.years.length === 0) return 'No, this dataset has none'
  if (!isInBBox(lat, lon, computed.bbox)) return 'No, outside the area with NDVI curves'
  const covered = yearRange(Math.min(...computed.years), Math.max(...computed.years))
  return computed.years.includes(year) ? `Yes, ${covered}` : `Not for ${year}, only ${covered}`
}

type ParamChanges = Record<string, string | null>

function PointDetail({
  product,
  stored,
  defaultThreshold,
  lat,
  lon,
}: {
  product: Product
  stored: StoredCoverage
  defaultThreshold: number
  lat: number
  lon: number
}) {
  const [params, setParams] = useSearchParams()
  const years = useMemo(() => [...stored.years].sort((a, b) => a - b), [stored.years])
  const year = parseYear(params.get('year'), years) ?? years[years.length - 1]
  const threshold = parseThreshold(params.get('threshold'), defaultThreshold)

  const update = useCallback(
    (changes: ParamChanges) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(changes)) {
            if (value === null) next.delete(key)
            else next.set(key, value)
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )
  const setYear = useCallback((next: number) => update({ year: String(next) }), [update])
  // The default stays out of the URL, so a reset leaves a clean address.
  const setThreshold = useCallback(
    (next: number) => update({ threshold: next === defaultThreshold ? null : String(next) }),
    [update, defaultThreshold],
  )
  const resetThreshold = useCallback(() => update({ threshold: null }), [update])

  const point = usePointMetric({ product: product.id, year, lat, lon })
  const series = useTimeseries({
    product: product.id,
    lat,
    lon,
    startYear: years[0],
    endYear: years[years.length - 1],
  })

  const step = stored.grid_step_deg
  const grid = step ? `stored ${step}° grid` : 'stored grid'

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <Link to={mapPath(lat, lon, year)} className={`self-start text-sm ${linkClass}`}>
              <span aria-hidden="true">← </span>Back to the map
            </Link>
            <div>
              <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">
                Point details
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <h1 tabIndex={-1} className="text-2xl font-semibold text-ink tabular-nums outline-none">
                  {formatPreciseCoordinates(lat, lon)}
                </h1>
                {product.synthetic && <Badge tone="warn">Synthetic</Badge>}
              </div>
              <p className="mt-0.5 text-sm text-ink-muted">{product.label}</p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
              <dt className="text-ink-muted">Stored metrics</dt>
              <dd className="text-ink">{storedAvailability(series, grid)}</dd>
              <dt className="text-ink-muted">NDVI curve</dt>
              <dd className="text-ink">{computedAvailability(product, lat, lon, year)}</dd>
            </dl>
          </div>
          <div className="w-full rounded-lg border border-line bg-surface p-3 lg:w-80">
            <YearSlider years={years} value={year} onChange={setYear} />
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <StoredSeasonSection
            year={year}
            point={point}
            series={series}
            gridStep={step}
            onSelectYear={setYear}
          />
          <NdviCurveSection
            product={product}
            stored={stored}
            years={years}
            lat={lat}
            lon={lon}
            year={year}
            threshold={threshold}
            defaultThreshold={defaultThreshold}
            onThresholdChange={setThreshold}
            onThresholdReset={resetThreshold}
            storedMetric={point.data}
          />
        </div>
      </div>
    </div>
  )
}
