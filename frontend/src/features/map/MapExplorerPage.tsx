import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'

import { useCatalog, useGrid } from '../../api/queries'
import type { Product, StoredCoverage } from '../../api/types'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { StatusMessage } from '../../components/StatusMessage'
import { describeError } from '../../lib/errors'
import { formatCoordinates } from '../../lib/format'
import { useResolvedTheme } from '../../lib/theme'
import { PointPanel } from '../point-panel/PointPanel'
import { buildColourScale } from './colourScale'
import { CoordinateSearch } from './CoordinateSearch'
import {
  buildCells,
  EMPTY_CELLS,
  findCellAt,
  isInBBox,
  resolveGridStep,
  type CellProperties,
} from './gridLayer'
import { Legend } from './Legend'
import { MetricPicker } from './MetricPicker'
import { METRICS, type MetricKey } from './metrics'
import { PhenologyMap } from './PhenologyMap'
import { parseCoordinate, parseMetric, parseYear } from './urlState'
import { YearSlider } from './YearSlider'

function PageMessage({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-xl px-4 py-12">{children}</div>
}

/** The map page: picks the product with stored metrics, then hands over to the explorer. */
export function MapExplorerPage() {
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

  const product = catalog.data.products.find((p) => (p.stored?.years.length ?? 0) > 0)
  if (!product?.stored) {
    return (
      <PageMessage>
        <StatusMessage tone="empty" title="No stored metrics to map">
          The API lists no product with stored phenology metrics.
        </StatusMessage>
      </PageMessage>
    )
  }
  return <Explorer product={product} stored={product.stored} />
}

type ParamChanges = Record<string, string | null>

function Explorer({ product, stored }: { product: Product; stored: StoredCoverage }) {
  const [params, setParams] = useSearchParams()
  const theme = useResolvedTheme()

  const years = useMemo(() => [...stored.years].sort((a, b) => a - b), [stored.years])
  const year = parseYear(params.get('year'), years) ?? years[years.length - 1]
  const metric = parseMetric(params.get('metric'))
  const lat = parseCoordinate(params.get('lat'))
  const lon = parseCoordinate(params.get('lon'))

  const grid = useGrid(product.id, year)
  const cells = useMemo(
    () => (grid.data ? buildCells(grid.data, resolveGridStep(stored, grid.data)) : undefined),
    [grid.data, stored],
  )
  // While a new year loads, the previous year stays on the map with a small note on top.
  const shownYear = grid.data?.year ?? year
  const loadingYear =
    !grid.isPending && grid.isFetching && (grid.isPlaceholderData || !grid.data) ? year : null

  // Only an exact stored point of the grid on screen counts as a selection.
  const selectedCell = cells && lat !== null && lon !== null ? findCellAt(cells, lat, lon) : null
  const selected = selectedCell?.properties ?? null

  const scale = useMemo(
    () =>
      buildColourScale({
        metric,
        values: (cells ?? EMPTY_CELLS).features.map((f) => f.properties[metric]),
        theme,
        year: shownYear,
      }),
    [cells, metric, theme, shownYear],
  )

  const update = useCallback(
    (changes: ParamChanges, replace: boolean) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(changes)) {
            if (value === null) next.delete(key)
            else next.set(key, value)
          }
          return next
        },
        { replace },
      )
    },
    [setParams],
  )
  const setYear = useCallback((next: number) => update({ year: String(next) }, true), [update])
  const setMetric = useCallback((next: MetricKey) => update({ metric: next }, true), [update])
  // String(number) round-trips a double exactly, so the API gets the stored value back.
  const selectCell = useCallback(
    (cell: CellProperties) => update({ lat: String(cell.lat), lon: String(cell.lon) }, false),
    [update],
  )

  // Closing the panel removes the focused button, so put focus somewhere predictable.
  const hintRef = useRef<HTMLParagraphElement>(null)
  const focusHint = useRef(false)
  const clearSelection = useCallback(() => {
    focusHint.current = true
    update({ lat: null, lon: null }, false)
  }, [update])
  useEffect(() => {
    if (selected === null && focusHint.current) {
      focusHint.current = false
      hintRef.current?.focus()
    }
  }, [selected])

  const metricLabel = METRICS[metric].label
  const description = cells
    ? `${cells.features.length} grid cells for ${shownYear}, ` +
      `coloured by ${metricLabel.toLowerCase()}. ` +
      (selected
        ? `Selected point: ${formatCoordinates(selected.lat, selected.lon)}. `
        : 'No point is selected. ') +
      'To select a cell with the keyboard, use the Find a point form.'
    : 'The grid is loading.'

  const step = stored.grid_step_deg

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <div className="flex flex-col gap-5 border-t border-line bg-surface p-4 lg:w-[22rem] lg:shrink-0 lg:overflow-y-auto lg:border-t-0 lg:border-r">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-ink">Phenology map</h1>
            {product.synthetic && <Badge tone="warn">Synthetic</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            Stored season metrics from {product.label}
            {step ? ` on a ${step}° grid` : ''}. Select a cell on the map, or find one by its
            coordinates.
          </p>
        </div>

        <MetricPicker value={metric} onChange={setMetric} />
        <YearSlider years={years} value={year} onChange={setYear} />
        <Legend metric={metric} legend={scale.legend} showComputedArea={!!product.computed} />
        <CoordinateSearch cells={cells} bbox={stored.bbox} onSelect={selectCell} />

        {selected ? (
          <PointPanel
            product={product.id}
            year={year}
            years={years}
            lat={selected.lat}
            lon={selected.lon}
            inComputedArea={isInBBox(selected.lat, selected.lon, product.computed?.bbox)}
            onClose={clearSelection}
            onSelectYear={setYear}
          />
        ) : (
          <p
            ref={hintRef}
            tabIndex={-1}
            className="rounded-lg border border-dashed border-line p-4 text-sm text-ink-muted"
          >
            No point selected. Select a cell to see its season and how it changes over the years.
          </p>
        )}
      </div>

      <div className="relative order-first h-[55vh] shrink-0 lg:order-none lg:h-auto lg:min-h-0 lg:flex-1">
        <PhenologyMap
          cells={cells ?? EMPTY_CELLS}
          fillColor={scale.fillColor}
          selected={selected}
          computedBBox={product.computed?.bbox}
          initialBBox={stored.bbox}
          theme={theme}
          onSelect={selectCell}
          label={`Map of ${metricLabel.toLowerCase()} in ${shownYear}`}
          description={description}
        />
        {grid.isPending && (
          <div className="absolute inset-x-3 top-3 mx-auto max-w-md shadow-panel">
            <StatusMessage tone="loading" title={`Loading the grid for ${year}`} />
          </div>
        )}
        {loadingYear !== null && (
          <div
            role="status"
            className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-surface px-3 py-1.5 shadow-panel"
          >
            <Spinner label={`Loading ${loadingYear}`} />
          </div>
        )}
        {grid.isError && !grid.isFetching && (
          <div className="absolute inset-x-3 top-3 mx-auto max-w-md shadow-panel">
            <StatusMessage
              tone="error"
              title={`Could not load the grid for ${year}`}
              action={<Button onClick={() => void grid.refetch()}>Try again</Button>}
            >
              {describeError(grid.error)}
            </StatusMessage>
          </div>
        )}
      </div>
    </div>
  )
}
