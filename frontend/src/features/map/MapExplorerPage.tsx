import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'

import { useCatalog, useGrid } from '../../api/queries'
import type { GridResponse, Product, StoredCoverage } from '../../api/types'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { PageTitle } from '../../components/PageTitle'
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

/** Tailwind's lg breakpoint: from here the controls and the point panel sit beside the map. */
const SIDE_BY_SIDE = '(min-width: 64rem)'

function matches(query: string): boolean {
  return window.matchMedia?.(query).matches ?? false
}

function PageMessage({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-xl px-4 py-12">{children}</div>
}

/** The map page: picks the product with stored metrics, then hands over to the explorer. */
export function MapExplorerPage() {
  return (
    <>
      <PageTitle>Phenology map</PageTitle>
      <CatalogGate />
    </>
  )
}

function CatalogGate() {
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

/** Where a selection came from: the map moves focus to the panel, the search keeps it. */
type SelectionSource = 'map' | 'search'

function Explorer({ product, stored }: { product: Product; stored: StoredCoverage }) {
  const [params, setParams] = useSearchParams()
  const theme = useResolvedTheme()

  const years = useMemo(() => [...stored.years].sort((a, b) => a - b), [stored.years])
  const year = parseYear(params.get('year'), years) ?? years[years.length - 1]
  const metric = parseMetric(params.get('metric'))
  const lat = parseCoordinate(params.get('lat'))
  const lon = parseCoordinate(params.get('lon'))

  const grid = useGrid(product.id, year)
  // A failed fetch leaves no data, so the last grid that loaded stays on the map (and keeps the
  // selection) under the error message.
  const [lastGrid, setLastGrid] = useState<GridResponse | undefined>(grid.data)
  if (grid.data && grid.data !== lastGrid) setLastGrid(grid.data)
  const shownGrid = grid.data ?? lastGrid
  const cells = useMemo(
    () => (shownGrid ? buildCells(shownGrid, resolveGridStep(stored, shownGrid)) : undefined),
    [shownGrid, stored],
  )
  const shownYear = shownGrid?.year ?? year

  // The failure to load this year's grid. Retrying puts the query back to pending, so this keeps
  // the message (and its focused Try again button) up until the grid arrives or the year changes.
  const [failure, setFailure] = useState<{ year: number; error: unknown } | null>(null)
  if (grid.isError && (!failure || failure.error !== grid.error || failure.year !== year)) {
    setFailure({ year, error: grid.error })
  } else if (failure && (failure.year !== year || (grid.isSuccess && !grid.isPlaceholderData))) {
    setFailure(null)
  }
  const retrying = failure !== null && grid.isFetching
  // While a new year loads, the previous year stays on the map with a small note on top.
  const loadingYear = failure === null && grid.isPlaceholderData && grid.isFetching ? year : null

  // Only an exact stored point of the grid on screen counts as a selection.
  const selectedCell = cells && lat !== null && lon !== null ? findCellAt(cells, lat, lon) : null
  const selected = selectedCell?.properties ?? null

  const scale = useMemo(
    () =>
      buildColourScale({
        metric,
        values: cells?.features.map((f) => f.properties[metric]),
        theme,
      }),
    [cells, metric, theme],
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

  // Below lg the point panel sits under the controls, out of sight of the map, so a selection
  // scrolls it into view; one made on the map also moves focus there.
  const panelRef = useRef<HTMLDivElement>(null)
  const pendingReveal = useRef<SelectionSource | null>(null)
  const revealPanel = useCallback((source: SelectionSource) => {
    const panel = panelRef.current
    if (!panel) return
    if (source === 'map') panel.focus({ preventScroll: true })
    const smooth = !matches('(prefers-reduced-motion: reduce)')
    panel.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' })
  }, [])
  useEffect(() => {
    const source = pendingReveal.current
    if (selected === null || source === null) return
    pendingReveal.current = null
    revealPanel(source)
  }, [selected, revealPanel])

  // String(number) round-trips a double exactly, so the API gets the stored value back.
  const select = useCallback(
    (cell: CellProperties, source: SelectionSource) => {
      const nextLat = String(cell.lat)
      const nextLon = String(cell.lon)
      const unchanged = params.get('lat') === nextLat && params.get('lon') === nextLon
      if (!unchanged) update({ lat: nextLat, lon: nextLon }, false)
      if (matches(SIDE_BY_SIDE)) return
      if (unchanged) revealPanel(source)
      else pendingReveal.current = source
    },
    [params, update, revealPanel],
  )
  const selectOnMap = useCallback((cell: CellProperties) => select(cell, 'map'), [select])
  const selectBySearch = useCallback((cell: CellProperties) => select(cell, 'search'), [select])

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
  const stillShown = cells && shownYear !== year ? `, so the map still shows ${shownYear}` : ''
  const failureNote = failure ? `The grid for ${year} could not be loaded${stillShown}.` : null
  const contents = cells
    ? `${cells.features.length} grid cells for ${shownYear}, ` +
      `coloured by ${metricLabel.toLowerCase()}. ` +
      (selected
        ? `Selected point: ${formatCoordinates(selected.lat, selected.lon)}. `
        : 'No point is selected. ') +
      'To select a cell with the keyboard, use the Find a point form.'
    : failureNote
      ? null
      : 'The grid is loading.'
  const description = [failureNote, contents].filter(Boolean).join(' ')

  const step = stored.grid_step_deg

  // The map comes first in the document, so below lg it is first on screen and in the Tab
  // order; from lg up it moves to the right of the controls, which then scroll on their own.
  return (
    <div className="relative flex flex-1 flex-col lg:min-h-0 lg:flex-row lg:overflow-hidden">
      <div className="relative h-[55vh] shrink-0 lg:order-last lg:h-auto lg:min-h-0 lg:flex-1">
        <PhenologyMap
          cells={cells ?? EMPTY_CELLS}
          fillColor={scale.fillColor}
          selected={selected}
          computedBBox={product.computed?.bbox}
          initialBBox={stored.bbox}
          theme={theme}
          onSelect={selectOnMap}
          label={`Map of ${metricLabel.toLowerCase()} in ${shownYear}`}
          description={description}
        />
        {grid.isPending && failure === null && (
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
        {failure && (
          <div className="absolute inset-x-3 top-3 mx-auto max-w-md shadow-panel">
            <StatusMessage
              tone="error"
              title={`Could not load the grid for ${year}`}
              action={
                <Button
                  aria-disabled={retrying}
                  className="aria-disabled:cursor-progress aria-disabled:opacity-70"
                  onClick={() => {
                    if (!retrying) void grid.refetch()
                  }}
                >
                  {retrying ? 'Trying again…' : 'Try again'}
                </Button>
              }
            >
              {describeError(failure.error)}
              {cells && shownYear !== year && ` The map still shows ${shownYear}.`}
            </StatusMessage>
          </div>
        )}
      </div>

      <div className="relative flex flex-col gap-5 border-t border-line bg-surface p-4 lg:w-[22rem] lg:shrink-0 lg:overflow-y-auto lg:border-t-0 lg:border-r">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
              Phenology map
            </h1>
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
        <CoordinateSearch
          cells={cells}
          bbox={stored.bbox}
          selected={selected}
          onSelect={selectBySearch}
        />

        {selected ? (
          <div ref={panelRef} tabIndex={-1} className="scroll-mt-2 outline-none">
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
          </div>
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
    </div>
  )
}
