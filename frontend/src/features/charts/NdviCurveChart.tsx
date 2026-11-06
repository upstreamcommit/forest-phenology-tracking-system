import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
} from 'react'

import type { NdviCurve, NdviObservation } from '../../api/types'
import { Button } from '../../components/Button'
import { dayOfYear, formatDate } from '../../lib/dates'
import {
  describeObservation,
  describeRelation,
  describeStored,
  estimateTextWidth,
  formatNdvi,
  justBeside,
  lineSegments,
  ndviAxis,
  ndviDecimals,
  placeThresholdLabel,
  seasonEdge,
  summariseCurve,
  thresholdDecimals,
  thresholdLabelTexts,
  thresholdRelation,
  type NdviPoint,
  type ThresholdRelation,
} from './ndviCurve'
import { linearScale, MONTH_LABELS, monthTicks } from './scales'
import { tooltipSide, visibleSpan, type TooltipSide } from './tooltipPlacement'
import { useElementWidth } from './useElementWidth'

export interface NdviCurveChartProps {
  /** The computed curve: observations, threshold and the computed start and end of season. */
  curve: NdviCurve
  /** Stored start and end of season for the same point and year, drawn for comparison. */
  stored?: { sos_date?: string | null; eos_date?: string | null } | null
  /** Accessible name of the chart, e.g. "NDVI through 2021 at 51.50° N, 0.50° W". */
  title: string
}

const HEIGHT = 240
/**
 * Room above and below the plot for the tooltip's two lines. Every composite's target spans the
 * plot's full height, so a tooltip anywhere in the plot would cover other composites and take
 * their hover. It goes above, or below when a scroll container hides the band above.
 */
const TOOLTIP_BAND = 44
const MARGIN = { top: 18, right: 12, bottom: 24, left: 34 }
const FALLBACK_WIDTH = 480
/** Dash patterns, so the threshold and stored dates differ from solid lines by more than colour. */
const THRESHOLD_DASH = '2 3'
const STORED_DASH = '6 3'

const TABLE_RELATION: Record<ThresholdRelation, string> = {
  above: 'Above',
  at: 'At',
  below: 'Below',
}

interface Point {
  obs: NdviObservation
  ndvi: number
  cx: number
  cy: number
  /** The hover and focus target reaches halfway to the neighbouring composites. */
  left: number
  right: number
  /** "start of season" or "end of season" on the composites the computed dates land on. */
  edge: string | null
}

/** Snaps a line to the pixel grid so 1px strokes stay sharp. */
function crisp(value: number): number {
  return Math.round(value) + 0.5
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The widths of the texts in `lines` (one per line) as an SVG text element draws them. Give the
 * returned ref to a hidden text element: a browser measures them there before the first paint.
 * jsdom cannot measure text, so the widths stay empty there.
 */
function useTextWidths(lines: string) {
  const [widths, setWidths] = useState<Readonly<Record<string, number>>>({})
  const ref = useCallback(
    (element: SVGTextElement | null) => {
      if (!element || typeof element.getComputedTextLength !== 'function') return
      const measured: Record<string, number> = {}
      for (const text of lines.split('\n')) {
        element.textContent = text
        measured[text] = element.getComputedTextLength()
      }
      element.textContent = ''
      setWidths(measured)
    },
    [lines],
  )
  return [ref, widths] as const
}

export function NdviCurveChart({ curve, stored, title }: NdviCurveChartProps) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>(FALLBACK_WIDTH)
  const [hoverDoy, setHoverDoy] = useState<number | null>(null)
  const [focusDoy, setFocusDoy] = useState<number | null>(null)
  const [tableOpen, setTableOpen] = useState(false)
  const [side, setSide] = useState<TooltipSide>('above')
  const plotRef = useRef<HTMLDivElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const captionId = useId()
  const summaryId = useId()
  const tableId = useId()

  const observations = useMemo(
    () => [...curve.observations].sort((a, b) => a.doy - b.doy),
    [curve.observations],
  )
  const segments = useMemo(
    () => lineSegments(observations).filter((segment) => segment.length > 1),
    [observations],
  )
  const axis = useMemo(() => ndviAxis(curve), [curve])
  const threshold = curve.threshold_ndvi
  const thresholdText = threshold === null ? '' : formatNdvi(threshold, thresholdDecimals(curve))
  const [measureLabels, labelWidths] = useTextWidths(thresholdLabelTexts(thresholdText).join('\n'))
  const summary = [summariseCurve(curve), describeStored(stored)].filter(Boolean).join(' ')

  // Geometry: day of year across, NDVI up the page.
  const plotLeft = MARGIN.left
  const plotRight = Math.max(plotLeft + 1, width - MARGIN.right)
  const plotTop = MARGIN.top
  const plotBottom = HEIGHT - MARGIN.bottom
  // Day d spans d to d + 1, so 1 Jan starts at the left edge and 31 Dec ends at the right.
  const yearEnd = dayOfYear(`${curve.year}-12-31`) + 1
  const x = linearScale([1, yearEnd], [plotLeft, plotRight])
  const y = linearScale(axis.domain, [plotBottom, plotTop])
  const linePath = (segment: NdviPoint[]) =>
    segment.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.doy)},${y(p.ndvi)}`).join(' ')

  const xs = observations.map((obs) => x(obs.doy))
  const halfGap = (i: number, j: number) =>
    j >= 0 && j < xs.length ? Math.abs(xs[j] - xs[i]) / 2 : null
  const points: Point[] = observations.flatMap((obs, i) => {
    if (obs.ndvi === null) return []
    const before = halfGap(i, i - 1) ?? halfGap(i, i + 1) ?? 8
    const after = halfGap(i, i + 1) ?? halfGap(i, i - 1) ?? 8
    return [
      {
        obs,
        ndvi: obs.ndvi,
        cx: xs[i],
        cy: y(obs.ndvi),
        left: Math.max(0, xs[i] - before),
        right: Math.min(width, xs[i] + after),
        edge: seasonEdge(obs.doy, curve),
      },
    ]
  })

  const sos = curve.sos_date ? dayOfYear(curve.sos_date) : null
  const eos = curve.eos_date ? dayOfYear(curve.eos_date) : null
  const storedSos = stored?.sos_date ? dayOfYear(stored.sos_date) : null
  const storedEos = stored?.eos_date ? dayOfYear(stored.eos_date) : null
  const hasSeason = sos !== null || eos !== null
  const hasStored = storedSos !== null || storedEos !== null

  const months = monthTicks(curve.year)
  const monthLabelEvery = (plotRight - plotLeft) / 12 < 22 ? 2 : 1

  // Drawn last, where the markers, the line and the dots leave room for it.
  const markerXs = (...doys: (number | null)[]) =>
    doys.flatMap((doy) => (doy === null ? [] : x(doy)))
  const thresholdLabel =
    threshold === null
      ? null
      : placeThresholdLabel({
          value: thresholdText,
          lineY: y(threshold),
          plot: { left: plotLeft, right: plotRight, top: plotTop, bottom: plotBottom },
          markers: markerXs(sos, eos),
          storedMarkers: markerXs(storedSos, storedEos),
          dots: points.map((point) => ({ x: point.cx, y: point.cy })),
          lines: segments.map((segment) => segment.map((p) => ({ x: x(p.doy), y: y(p.ndvi) }))),
          measure: (text) => labelWidths[text] ?? estimateTextWidth(text),
        })

  const activeDoy = hoverDoy ?? focusDoy
  const active = points.find((point) => point.obs.doy === activeDoy)

  const setPlot = useCallback(
    (element: HTMLDivElement | null) => {
      plotRef.current = element
      return containerRef(element)
    },
    [containerRef],
  )
  // Picks the band the tooltip can be seen in, when it opens and as anything around it scrolls.
  const placeTooltip = useCallback(() => {
    const plot = plotRef.current
    if (plot) setSide(tooltipSide(plot.getBoundingClientRect(), visibleSpan(plot), TOOLTIP_BAND))
  }, [])
  const tooltipOpen = active !== undefined
  useEffect(() => {
    if (!tooltipOpen) return
    // Scroll events don't bubble, but a capturing listener on the window hears every scroller's.
    const options = { capture: true, passive: true }
    window.addEventListener('scroll', placeTooltip, options)
    window.addEventListener('resize', placeTooltip)
    return () => {
      window.removeEventListener('scroll', placeTooltip, options)
      window.removeEventListener('resize', placeTooltip)
    }
  }, [tooltipOpen, placeTooltip])

  // A tooltip opened by the pointer alone must close on Escape too, wherever focus is (WCAG
  // 1.4.13). It stays closed until the pointer enters a composite again.
  useEffect(() => {
    if (hoverDoy === null) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setHoverDoy(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [hoverDoy])

  const hideTooltip = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || activeDoy === null) return
    // Escape dismisses the tooltip only, not a panel or dialog around the chart.
    event.stopPropagation()
    setHoverDoy(null)
    setFocusDoy(null)
  }

  return (
    // aria-labelledby repeats the figcaption's implicit naming for tools that don't apply it.
    <figure
      aria-labelledby={captionId}
      aria-describedby={summaryId}
      className="flex flex-col gap-2"
    >
      <figcaption id={captionId} className="text-sm font-semibold text-ink">
        {title}
      </figcaption>
      <p id={summaryId} className="sr-only">
        {summary}
      </p>

      <div
        ref={setPlot}
        className="relative"
        style={{ height: HEIGHT, marginTop: TOOLTIP_BAND, marginBottom: TOOLTIP_BAND }}
      >
        <svg
          aria-hidden="true"
          focusable="false"
          width="100%"
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block overflow-visible text-[10px] tabular-nums"
        >
          {threshold !== null && <text ref={measureLabels} visibility="hidden" />}
          {sos !== null && eos !== null && (
            <rect
              data-season=""
              x={x(Math.min(sos, eos))}
              y={plotTop}
              width={Math.abs(x(eos) - x(sos))}
              height={plotBottom - plotTop}
              className="fill-accent/15"
            />
          )}

          {axis.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={plotLeft}
                x2={plotRight}
                y1={crisp(y(tick))}
                y2={crisp(y(tick))}
                className="stroke-line"
              />
              <text
                x={plotLeft - 6}
                y={y(tick)}
                dy="0.32em"
                textAnchor="end"
                className="fill-ink-muted"
              >
                {tick.toFixed(axis.decimals)}
              </text>
            </g>
          ))}

          <line
            x1={plotLeft}
            x2={plotRight}
            y1={crisp(plotBottom)}
            y2={crisp(plotBottom)}
            className="stroke-line-strong"
          />
          {months.map((doy, month) => (
            <g key={doy}>
              <line
                x1={crisp(x(doy))}
                x2={crisp(x(doy))}
                y1={plotBottom}
                y2={plotBottom + 4}
                className="stroke-line-strong"
              />
              {month % monthLabelEvery === 0 && (
                <text
                  x={x((doy + (months[month + 1] ?? yearEnd)) / 2)}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  className="fill-ink-muted"
                >
                  {MONTH_LABELS[month]}
                </text>
              )}
            </g>
          ))}

          {threshold !== null && (
            <line
              data-threshold=""
              x1={plotLeft}
              x2={plotRight}
              y1={y(threshold)}
              y2={y(threshold)}
              strokeWidth={1.5}
              strokeDasharray={THRESHOLD_DASH}
              className="stroke-ink-muted"
            />
          )}

          {[storedSos, storedEos].map((doy, index) =>
            doy === null ? null : (
              <line
                key={index}
                data-marker={index === 0 ? 'stored-sos' : 'stored-eos'}
                x1={x(doy)}
                x2={x(doy)}
                y1={plotTop}
                y2={plotBottom}
                strokeWidth={1.5}
                strokeDasharray={STORED_DASH}
                className="stroke-ink"
              />
            ),
          )}

          {sos !== null && (
            <g>
              <line
                data-marker="sos"
                x1={x(sos)}
                x2={x(sos)}
                y1={plotTop}
                y2={plotBottom}
                strokeWidth={1.5}
                className="stroke-accent"
              />
              <text
                x={x(sos) - 3}
                y={plotTop - 5}
                textAnchor="end"
                className="fill-accent font-medium"
              >
                Start
              </text>
            </g>
          )}
          {eos !== null && (
            <g>
              <line
                data-marker="eos"
                x1={x(eos)}
                x2={x(eos)}
                y1={plotTop}
                y2={plotBottom}
                strokeWidth={1.5}
                className="stroke-accent"
              />
              <text x={x(eos) + 3} y={plotTop - 5} className="fill-accent font-medium">
                End
              </text>
            </g>
          )}

          {active && (
            <line
              x1={active.cx}
              x2={active.cx}
              y1={plotTop}
              y2={plotBottom}
              className="stroke-line-strong"
            />
          )}

          {segments.map((segment) => (
            <path
              key={segment[0].doy}
              data-line=""
              d={linePath(segment)}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="fill-none stroke-accent"
            />
          ))}

          {points.map((point) => (
            <circle
              key={point.obs.doy}
              data-doy={point.obs.doy}
              cx={point.cx}
              cy={point.cy}
              r={point === active ? 5 : 3}
              strokeWidth={1.5}
              className="fill-accent stroke-surface"
            />
          ))}

          {thresholdLabel && (
            <text
              data-threshold-label=""
              x={thresholdLabel.x}
              y={thresholdLabel.baseline}
              strokeWidth={3}
              paintOrder="stroke"
              className="fill-ink-muted stroke-surface"
            >
              {thresholdLabel.text}
            </text>
          )}
        </svg>

        {points.map((point) => {
          const doy = point.obs.doy
          return (
            <div
              key={doy}
              role="img"
              tabIndex={0}
              aria-label={describeObservation(point.obs.date, point.ndvi, threshold, point.edge)}
              style={{ left: point.left, top: 0, width: point.right - point.left, height: HEIGHT }}
              onMouseEnter={() => {
                placeTooltip()
                setHoverDoy(doy)
              }}
              onMouseLeave={(event: MouseEvent) => {
                // Moving up onto the tooltip keeps it open, so it can be hovered (WCAG 1.4.13).
                const to = event.relatedTarget
                if (to instanceof Node && tooltipRef.current?.contains(to)) return
                setHoverDoy((current) => (current === doy ? null : current))
              }}
              onFocus={() => {
                placeTooltip()
                setFocusDoy(doy)
              }}
              onBlur={() => setFocusDoy((current) => (current === doy ? null : current))}
              onKeyDown={hideTooltip}
              className="absolute rounded-md"
            />
          )
        })}

        {active && (
          <Tooltip
            ref={tooltipRef}
            point={active}
            threshold={threshold}
            onMouseLeave={() => setHoverDoy(null)}
            style={tooltipPosition(active.cx, width, side)}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul
          aria-hidden="true"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted"
        >
          <li className="flex items-center gap-1.5">
            <svg width="16" height="8" className="overflow-visible">
              <line x1="0" x2="16" y1="4" y2="4" strokeWidth={2} className="stroke-accent" />
              <circle cx="8" cy="4" r="3" className="fill-accent" />
            </svg>
            NDVI
          </li>
          {threshold !== null && (
            <li className="flex items-center gap-1.5">
              <svg width="16" height="8" className="overflow-visible">
                <line
                  x1="0"
                  x2="16"
                  y1="4"
                  y2="4"
                  strokeWidth={1.5}
                  strokeDasharray={THRESHOLD_DASH}
                  className="stroke-ink-muted"
                />
              </svg>
              Threshold
            </li>
          )}
          {hasSeason && (
            <li className="flex items-center gap-1.5">
              <svg width="14" height="14" className="overflow-visible">
                <rect x="1" y="0" width="12" height="14" className="fill-accent/15" />
                <line x1="1" x2="1" y1="0" y2="14" strokeWidth={1.5} className="stroke-accent" />
                <line x1="13" x2="13" y1="0" y2="14" strokeWidth={1.5} className="stroke-accent" />
              </svg>
              Computed season
            </li>
          )}
          {hasStored && (
            <li className="flex items-center gap-1.5">
              <svg width="6" height="14" className="overflow-visible">
                <line
                  x1="3"
                  x2="3"
                  y1="0"
                  y2="14"
                  strokeWidth={1.5}
                  strokeDasharray={STORED_DASH}
                  className="stroke-ink"
                />
              </svg>
              Stored start/end
            </li>
          )}
        </ul>
        <Button
          variant="ghost"
          aria-expanded={tableOpen}
          aria-controls={tableId}
          onClick={() => setTableOpen((open) => !open)}
        >
          {tableOpen ? 'Hide data table' : 'Show data table'}
        </Button>
      </div>

      <div id={tableId} hidden={!tableOpen} className="overflow-x-auto">
        <table className="w-full text-left text-xs tabular-nums">
          <caption className="sr-only">{title}, by date</caption>
          <thead className="text-ink-muted">
            <tr className="border-b border-line">
              <th scope="col" className="py-1 pr-3 font-medium">
                Date
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Day of year
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                NDVI
              </th>
              {threshold !== null && (
                <th scope="col" className="py-1 font-medium">
                  Threshold ({thresholdText})
                </th>
              )}
            </tr>
          </thead>
          <tbody className="text-ink">
            {observations.map((obs) => {
              const edge = seasonEdge(obs.doy, curve)
              const relation = obs.ndvi === null ? null : thresholdRelation(obs.ndvi, threshold)
              const just = obs.ndvi !== null && justBeside(obs.ndvi, threshold)
              const relationText = just ? `Just ${relation}` : relation && TABLE_RELATION[relation]
              return (
                <tr key={obs.doy} className="border-b border-line last:border-0">
                  <th scope="row" className="py-1 pr-3 font-medium">
                    {formatDate(obs.date)}
                    {edge && <span className="font-normal text-ink-muted"> ({edge})</span>}
                  </th>
                  <td className="py-1 pr-3">{obs.doy}</td>
                  <td className="py-1 pr-3">
                    {obs.ndvi === null
                      ? 'No data'
                      : formatNdvi(obs.ndvi, ndviDecimals(obs.ndvi, threshold))}
                  </td>
                  {threshold !== null && (
                    <td className="py-1">{relationText ?? '–'}</td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </figure>
  )
}

/**
 * In the band above or below the plot, its edge on the targets' edge, so it covers no composite
 * and the pointer reaches it by moving straight up (or down) from the dot. It is anchored at the
 * dot's x by the same fraction of its own width as the dot is of the chart's, which keeps it
 * inside the chart, in line with the dot, whatever its width.
 */
function tooltipPosition(cx: number, width: number, side: TooltipSide): CSSProperties {
  const shift = (100 * cx) / width
  return {
    left: cx,
    [side === 'above' ? 'bottom' : 'top']: HEIGHT,
    maxWidth: width,
    transform: `translateX(-${shift}%)`,
  }
}

function Tooltip({
  ref,
  point,
  threshold,
  style,
  onMouseLeave,
}: {
  ref: Ref<HTMLDivElement>
  point: Point
  threshold: number | null
  style: CSSProperties
  onMouseLeave: () => void
}) {
  // The threshold's value is on the chart; the accessible name repeats it where it matters.
  const relation = describeRelation(point.ndvi, threshold, false)
  const value = formatNdvi(point.ndvi, ndviDecimals(point.ndvi, threshold))
  // Two lines, so it fits the band. The first fits a phone-wide chart; the second is one line
  // high, and puts the season edge first, so a relation with no room beside it is cut, not
  // wrapped: an edge composite is always at or above the threshold anyway.
  return (
    <div
      ref={ref}
      role="tooltip"
      style={style}
      onMouseLeave={onMouseLeave}
      className="absolute z-10 w-max rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-ink tabular-nums shadow-panel"
    >
      <p>
        <span className="font-semibold">{formatDate(point.obs.date)}</span>{' '}
        <span className="whitespace-nowrap">· day {point.obs.doy}</span>{' '}
        <span className="whitespace-nowrap">· NDVI {value}</span>
      </p>
      {(relation || point.edge) && (
        <p className="flex h-4 flex-wrap gap-x-1 overflow-hidden text-ink-muted">
          {point.edge && (
            <span className="whitespace-nowrap font-medium text-accent">
              {sentence(point.edge)}
            </span>
          )}
          {point.edge && relation && ' '}
          {relation && (
            <span className="whitespace-nowrap">
              {point.edge ? `· ${relation}` : sentence(relation)}
            </span>
          )}
        </p>
      )}
    </div>
  )
}
