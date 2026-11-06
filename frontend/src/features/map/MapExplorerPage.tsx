import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react'
import { Link, useSearchParams } from 'react-router'

import { isPointPanelQuery, useCatalog, useGrid } from '../../api/queries'
import type { GridResponse, Product, StoredCoverage } from '../../api/types'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { PageTitle } from '../../components/PageTitle'
import { Spinner } from '../../components/Spinner'
import { StatusMessage } from '../../components/StatusMessage'
import { describeError } from '../../lib/errors'
import { formatCoordinates } from '../../lib/format'
import { useResolvedTheme } from '../../lib/theme'
import { pointDetailPath } from '../point-detail/paths'
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
import { PhenologyMap, type PhenologyMapHandle } from './PhenologyMap'
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

/** The longest a revealed panel is followed as it grows, should its data never settle. */
const FOLLOW_CAP_MS = 15_000
/** How long the panel is still followed once its data is in, to draw what came in. */
const SETTLE_MS = 500
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const

/**
 * Calls `onGrow` whenever `element` grows, until the point panel's queries have settled (or
 * FOLLOW_CAP_MS has passed), or the user scrolls, taps or presses a key. Returns a function that
 * stops it early.
 */
function followGrowth(
  element: HTMLElement,
  onGrow: () => void,
  queryClient: QueryClient,
): () => void {
  let height = element.getBoundingClientRect().height
  const observer = new ResizeObserver(() => {
    const next = element.getBoundingClientRect().height
    if (next > height) onGrow()
    height = next
  })
  let timer = 0
  let unsubscribe = () => {}
  const stop = () => {
    observer.disconnect()
    unsubscribe()
    window.clearTimeout(timer)
    for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, stop)
  }
  const stopOnceSettled = () => {
    if (queryClient.isFetching({ predicate: isPointPanelQuery }) > 0) return
    unsubscribe()
    window.clearTimeout(timer)
    timer = window.setTimeout(stop, SETTLE_MS)
  }
  observer.observe(element)
  timer = window.setTimeout(stop, FOLLOW_CAP_MS)
  for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, stop, { passive: true })
  unsubscribe = queryClient.getQueryCache().subscribe(stopOnceSettled)
  // The panel's queries have started by now: its effects run before the page's.
  stopOnceSettled()
  return stop
}

/** Which copy of the failure message focus was in, and whether it got there by keyboard. */
interface FailureFocus {
  copy: 'map' | 'controls'
  keyboard: boolean
}

function Explorer({ product, stored }: { product: Product; stored: StoredCoverage }) {
  const [params, setParams] = useSearchParams()
  const theme = useResolvedTheme()
  const queryClient = useQueryClient()

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
  // While a new year loads, the previous year stays on the map with a small note.
  const loadingYear = failure === null && grid.isPlaceholderData && grid.isFetching ? year : null
  const gridPending = grid.isPending && failure === null

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
  // Whether the user has changed the year on this visit (see underSlider).
  const [yearChanged, setYearChanged] = useState(false)
  const setYear = useCallback(
    (next: number) => {
      setYearChanged(true)
      update({ year: String(next) }, true)
    },
    [update],
  )
  const setMetric = useCallback((next: MetricKey) => update({ metric: next }, true), [update])

  // Below lg the point panel sits under the controls, out of sight of the map, so a selection
  // scrolls it into view; one made on the map also moves focus there.
  const panelRef = useRef<HTMLDivElement>(null)
  const pendingReveal = useRef<SelectionSource | null>(null)
  const stopFollowing = useRef<(() => void) | null>(null)
  useEffect(() => () => stopFollowing.current?.(), [])
  const revealPanel = useCallback((source: SelectionSource) => {
    const panel = panelRef.current
    if (!panel) return
    if (source === 'map') panel.focus({ preventScroll: true })
    const behavior = matches('(prefers-reduced-motion: reduce)') ? 'auto' : 'smooth'
    const reveal = () => panel.scrollIntoView({ block: 'start', behavior })
    reveal()
    // The panel grows as its data arrives, and until then the page may be too short to bring
    // its top up to the top of the screen, so reveal it again as it grows.
    stopFollowing.current?.()
    stopFollowing.current = followGrowth(panel, reveal, queryClient)
  }, [queryClient])
  useEffect(() => {
    const source = pendingReveal.current
    if (selected === null || source === null) return
    pendingReveal.current = null
    revealPanel(source)
  }, [selected, revealPanel])

  // String(number) round-trips a double exactly, so the API gets the stored value back. The
  // selection is compared by value: the URL may spell the same point differently ("51.50").
  const select = useCallback(
    (cell: CellProperties, source: SelectionSource) => {
      const unchanged = lat === cell.lat && lon === cell.lon
      if (!unchanged) update({ lat: String(cell.lat), lon: String(cell.lon) }, false)
      if (matches(SIDE_BY_SIDE)) return
      if (unchanged) {
        pendingReveal.current = null
        revealPanel(source)
      } else {
        pendingReveal.current = source
      }
    },
    [lat, lon, update, revealPanel],
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

  // When the failure message goes (after a successful Try again, say) while it held focus,
  // focus moves to the control next to the copy the user acted on, rather than dropping to the
  // page: the map for the copy on the map, the Year slider for the one under the slider.
  const mapRef = useRef<PhenologyMapHandle>(null)
  const yearRef = useRef<HTMLInputElement>(null)
  const failureFocus = useRef<FailureFocus | null>(null)
  const noteFailureFocus = (copy: FailureFocus['copy'], event: FocusEvent) => {
    failureFocus.current = { copy, keyboard: event.target.matches(':focus-visible') }
  }
  // Focus that leaves for no other element (to the page) is still the message's.
  const onFailureBlur = (event: FocusEvent) => {
    if (event.relatedTarget) failureFocus.current = null
  }
  useEffect(() => {
    const focused = failureFocus.current
    if (failure !== null || focused === null) return
    failureFocus.current = null
    const active = document.activeElement
    if (active && active !== document.body) return
    const target = (focused.copy === 'map' && mapRef.current?.canvas()) || yearRef.current
    if (!target) return
    target.focus({ preventScroll: true })
    // Keyboard users are taken to it; a mouse user's scroll position is theirs. 'nearest' leaves
    // a target that is already in view where it is.
    if (focused.keyboard) target.scrollIntoView({ block: 'nearest' })
  }, [failure])

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

  const failureMessage = failure && (
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
  )
  // The state of the year being loaded is drawn on the map from lg up. Below lg, where the map
  // may be scrolled out of sight, it goes under the Year slider once a grid is on the map or the
  // user has changed the year; the first load's stays on the map. Only one copy of each is
  // displayed (and so in the accessibility tree) at a time.
  const underSlider = cells !== undefined || yearChanged
  const byMap = underSlider ? 'hidden lg:block' : ''

  const step = stored.grid_step_deg

  // The document order is heading, map, controls, as on screen: stacked below lg; from lg up
  // the map fills the left and the heading and controls share a column on the right, where the
  // controls scroll on their own.
  return (
    <div className="relative flex flex-1 flex-col lg:grid lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
      <div className="relative border-b border-line bg-surface p-4 lg:col-start-2 lg:row-start-1 lg:border-b-0 lg:border-l lg:pb-1">
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

      <div className="relative h-[55vh] shrink-0 lg:col-start-1 lg:row-[1/3] lg:h-auto lg:min-h-0">
        <PhenologyMap
          ref={mapRef}
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
        {gridPending && (
          <div className={`absolute inset-x-3 top-3 mx-auto max-w-md shadow-panel ${byMap}`}>
            <StatusMessage tone="loading" title={`Loading the grid for ${year}`} />
          </div>
        )}
        {/* Below lg the messages are under the Year slider; the map says which year it shows. */}
        {cells && shownYear !== year && (
          <p
            aria-hidden="true"
            className="pointer-events-none absolute top-3 left-3 rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink shadow-panel lg:hidden"
          >
            Showing {shownYear} ({failure ? `${year} failed` : `loading ${year}`})
          </p>
        )}
        {loadingYear !== null && (
          <div
            role="status"
            className="absolute top-3 left-1/2 hidden -translate-x-1/2 rounded-full bg-surface px-3 py-1.5 shadow-panel lg:block"
          >
            <Spinner label={`Loading ${loadingYear}`} />
          </div>
        )}
        {failureMessage && (
          <div
            className={`absolute inset-x-3 top-3 mx-auto max-w-md shadow-panel ${byMap}`}
            onFocus={(event) => noteFailureFocus('map', event)}
            onBlur={onFailureBlur}
          >
            {failureMessage}
          </div>
        )}
      </div>

      <div className="relative flex flex-col gap-5 border-t border-line bg-surface p-4 lg:col-start-2 lg:row-start-2 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l">
        <MetricPicker value={metric} onChange={setMetric} />
        <div className="flex flex-col gap-3">
          <YearSlider ref={yearRef} years={years} value={year} onChange={setYear} />
          {underSlider && (loadingYear !== null || gridPending) && (
            <div role="status" className="lg:hidden">
              <Spinner label={`Loading ${year}`} />
            </div>
          )}
          {failureMessage && underSlider && (
            <div
              className="lg:hidden"
              onFocus={(event) => noteFailureFocus('controls', event)}
              onBlur={onFailureBlur}
            >
              {failureMessage}
            </div>
          )}
        </div>
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
              actions={
                <Link
                  to={pointDetailPath(selected.lat, selected.lon, year)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-hover"
                >
                  Open point details <span aria-hidden="true">→</span>
                </Link>
              }
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
