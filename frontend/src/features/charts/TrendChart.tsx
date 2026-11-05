import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'

import type { YearMetric } from '../../api/types'
import { Button } from '../../components/Button'
import { dateFromDayOfYear, formatDate, formatDayMonth } from '../../lib/dates'
import { formatDays } from '../../lib/format'
import { linearScale, MONTH_LABELS, monthTicks } from './scales'
import { averageSeason, seasonDays, yearRange, type SeasonDays } from './seasons'
import { useElementWidth } from './useElementWidth'

export interface TrendChartProps {
  /** One entry per year, in any order. Years missing a date get a "no data" marker. */
  metrics: YearMetric[]
  /** The year drawn in the accent colour, such as the year selected on the map. */
  highlightYear?: number
  /** When given, each year becomes a button that calls this with its year. */
  onSelectYear?: (year: number) => void
  /** The chart's visible caption and accessible name. */
  title: string
}

const HEIGHT = 180
const MARGIN = { top: 10, right: 8, bottom: 24, left: 34 }
const FALLBACK_WIDTH = 480
/** Days of air above and below the data, so bars don't touch the plot edges. */
const DOY_PADDING = 10
/** The plot range when no year has dates: March to November. */
const EMPTY_DOMAIN: [number, number] = [60, 335]

interface Row {
  metric: YearMetric
  season: SeasonDays | null
  /** The API's season length, or the gap between the dates when it is missing. */
  length: number | null
}

function dateText(iso: string | null | undefined, missing = 'No data'): string {
  return iso ? formatDate(iso) : missing
}

/** The accessible name of a year's bar: everything its tooltip shows. */
function describeYear({ metric, length }: Row): string {
  if (!metric.sos_date && !metric.eos_date) return `${metric.year}: no data`
  const parts = [
    `start ${dateText(metric.sos_date, 'no data')}`,
    `end ${dateText(metric.eos_date, 'no data')}`,
  ]
  if (length !== null) parts.push(`season ${formatDays(length)}`)
  return `${metric.year}: ${parts.join(', ')}`
}

/** Snaps a horizontal line to the pixel grid so 1px strokes stay sharp. */
function crisp(value: number): number {
  return Math.round(value) + 0.5
}

export function TrendChart({ metrics, highlightYear, onSelectYear, title }: TrendChartProps) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>(FALLBACK_WIDTH)
  const [hoverYear, setHoverYear] = useState<number | null>(null)
  const [focusYear, setFocusYear] = useState<number | null>(null)
  const [tableOpen, setTableOpen] = useState(false)
  const captionId = useId()
  const tableId = useId()

  const rows = useMemo<Row[]>(
    () =>
      [...metrics]
        .sort((a, b) => a.year - b.year)
        .map((metric) => {
          const season = seasonDays(metric)
          return { metric, season, length: metric.season_length ?? season?.length ?? null }
        }),
    [metrics],
  )
  const average = useMemo(() => averageSeason(metrics), [metrics])
  const showAverage = average !== null && average.count > 1

  // Geometry: one slot per year across, day of year up the page (later dates higher).
  const plotLeft = MARGIN.left
  const plotRight = Math.max(plotLeft + 1, width - MARGIN.right)
  const plotTop = MARGIN.top
  const plotBottom = HEIGHT - MARGIN.bottom
  const slot = (plotRight - plotLeft) / Math.max(rows.length, 1)
  const barWidth = Math.max(4, Math.min(14, slot * 0.45))
  const xCenter = (index: number) => plotLeft + slot * (index + 0.5)

  const days = rows.flatMap((row) => (row.season ? [row.season.sos, row.season.eos] : []))
  const domain: [number, number] =
    days.length > 0
      ? [
          Math.max(1, Math.min(...days) - DOY_PADDING),
          Math.min(366, Math.max(...days) + DOY_PADDING),
        ]
      : EMPTY_DOMAIN
  const y = linearScale(domain, [plotBottom, plotTop])

  // Month positions shift by a day in leap years; one reference year keeps the axis steady.
  const refYear = highlightYear ?? rows.at(-1)?.metric.year ?? 2001
  const ticks = monthTicks(refYear)
    .map((doy, month) => ({ doy, label: MONTH_LABELS[month] }))
    .filter((tick) => tick.doy >= domain[0] && tick.doy <= domain[1])
  const monthLabelEvery = Math.abs(y(31) - y(0)) < 14 ? 2 : 1
  const shortYears = slot < 30
  const yearLabelEvery = shortYears ? Math.max(1, Math.ceil(20 / slot)) : 1

  const activeYear = hoverYear ?? focusYear
  const activeIndex = rows.findIndex((row) => row.metric.year === activeYear)
  const activeRow: Row | undefined = rows[activeIndex]
  const highlightInData = rows.some((row) => row.metric.year === highlightYear)
  const hasMissing = rows.some((row) => row.season === null)

  const hideTooltip = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || activeYear === null) return
    // Escape dismisses the tooltip only, not a panel or dialog around the chart.
    event.stopPropagation()
    setHoverYear(null)
    setFocusYear(null)
  }

  return (
    // aria-labelledby repeats the figcaption's implicit naming for tools that don't apply it.
    <figure aria-labelledby={captionId} className="flex flex-col gap-2">
      <figcaption id={captionId} className="text-sm font-semibold text-ink">
        {title}
      </figcaption>
      <p className="sr-only">
        Each year is a bar from the start to the end of its season.
        {onSelectYear ? ' Select a year to show it.' : ''}
      </p>

      <div ref={containerRef} className="relative" style={{ height: HEIGHT }}>
        <svg
          aria-hidden="true"
          focusable="false"
          width="100%"
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block overflow-visible text-[10px] tabular-nums"
        >
          {rows.map((row, index) => {
            const highlighted = row.metric.year === highlightYear
            if (!highlighted && index !== activeIndex) return null
            return (
              <rect
                key={row.metric.year}
                x={xCenter(index) - slot / 2 + 1}
                y={plotTop}
                width={Math.max(slot - 2, 0)}
                height={plotBottom - plotTop}
                rx={4}
                className={highlighted ? 'fill-accent-soft' : 'fill-surface-sunken'}
              />
            )
          })}

          {ticks.map((tick, index) => (
            <g key={tick.doy}>
              <line
                x1={plotLeft}
                x2={plotRight}
                y1={crisp(y(tick.doy))}
                y2={crisp(y(tick.doy))}
                className="stroke-line"
              />
              {index % monthLabelEvery === 0 && (
                <text
                  x={plotLeft - 6}
                  y={y(tick.doy)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-ink-muted"
                >
                  {tick.label}
                </text>
              )}
            </g>
          ))}

          {showAverage &&
            [average.sos, average.eos].map((doy, index) => (
              <line
                key={index}
                data-average={index === 0 ? 'sos' : 'eos'}
                x1={plotLeft}
                x2={plotRight}
                y1={crisp(y(doy))}
                y2={crisp(y(doy))}
                strokeDasharray="4 3"
                className="stroke-ink-subtle"
              />
            ))}

          {rows.map((row, index) => {
            const year = row.metric.year
            const cx = xCenter(index)
            if (!row.season) {
              return (
                <circle
                  key={year}
                  data-year={year}
                  data-missing=""
                  cx={cx}
                  cy={(plotTop + plotBottom) / 2}
                  r={3.5}
                  strokeDasharray="2 1.5"
                  className="fill-none stroke-ink-subtle"
                />
              )
            }
            // min/max keep the bar drawable even if a season's end came before its start.
            const top = Math.min(y(row.season.eos), y(row.season.sos))
            const bottom = Math.max(y(row.season.eos), y(row.season.sos))
            const tone =
              year === highlightYear
                ? 'fill-accent'
                : index === activeIndex
                  ? 'fill-ink-subtle'
                  : 'fill-ink-subtle/70'
            return (
              <rect
                key={year}
                data-year={year}
                x={cx - barWidth / 2}
                y={top}
                width={barWidth}
                height={Math.max(bottom - top, 2)}
                rx={barWidth / 2}
                className={tone}
              />
            )
          })}

          {rows.map((row, index) =>
            index % yearLabelEvery === 0 || row.metric.year === highlightYear ? (
              <text
                key={row.metric.year}
                x={xCenter(index)}
                y={HEIGHT - 8}
                textAnchor="middle"
                className={
                  row.metric.year === highlightYear ? 'fill-ink font-semibold' : 'fill-ink-muted'
                }
              >
                {shortYears ? `’${String(row.metric.year).slice(-2)}` : row.metric.year}
              </text>
            ) : null,
          )}
        </svg>

        {rows.map((row, index) => {
          const year = row.metric.year
          const shared = {
            'aria-label': describeYear(row),
            'aria-current': year === highlightYear ? ('true' as const) : undefined,
            style: { left: xCenter(index) - slot / 2, top: 0, width: slot, height: HEIGHT },
            onMouseEnter: () => setHoverYear(year),
            onMouseLeave: () => setHoverYear((current) => (current === year ? null : current)),
            onFocus: () => setFocusYear(year),
            onBlur: () => setFocusYear((current) => (current === year ? null : current)),
            onKeyDown: hideTooltip,
          }
          return onSelectYear ? (
            <button
              key={year}
              type="button"
              {...shared}
              onClick={() => onSelectYear(year)}
              className="absolute cursor-pointer rounded-md"
            />
          ) : (
            <div key={year} role="img" tabIndex={0} {...shared} className="absolute rounded-md" />
          )
        })}

        {activeRow && (
          <Tooltip
            row={activeRow}
            style={tooltipPosition({
              cx: xCenter(activeIndex),
              barWidth,
              width,
              mid: activeRow.season
                ? (y(activeRow.season.sos) + y(activeRow.season.eos)) / 2
                : (plotTop + plotBottom) / 2,
            })}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul
          aria-hidden="true"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted"
        >
          {highlightInData && (
            <li className="flex items-center gap-1.5">
              <span className="h-3 w-1.5 rounded-full bg-accent" />
              {highlightYear}
            </li>
          )}
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-1.5 rounded-full bg-ink-subtle/70" />
            {highlightInData ? 'Other years' : 'Start to end of season'}
          </li>
          {showAverage && (
            <li className="flex items-center gap-1.5">
              <svg width="16" height="6" className="overflow-visible">
                <line
                  x1="0"
                  x2="16"
                  y1="3"
                  y2="3"
                  strokeDasharray="4 3"
                  className="stroke-ink-subtle"
                />
              </svg>
              Average {yearRange(average.firstYear, average.lastYear)}
            </li>
          )}
          {hasMissing && (
            <li className="flex items-center gap-1.5">
              <svg width="8" height="8" className="overflow-visible">
                <circle
                  cx="4"
                  cy="4"
                  r="3.5"
                  strokeDasharray="2 1.5"
                  className="fill-none stroke-ink-subtle"
                />
              </svg>
              No data
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
          <caption className="sr-only">{title}, by year</caption>
          <thead className="text-ink-muted">
            <tr className="border-b border-line">
              <th scope="col" className="py-1 pr-3 font-medium">
                Year
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Start of season
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                End of season
              </th>
              <th scope="col" className="py-1 font-medium">
                Season length
              </th>
            </tr>
          </thead>
          <tbody className="text-ink">
            {rows.map((row) => {
              const highlighted = row.metric.year === highlightYear
              return (
                <tr
                  key={row.metric.year}
                  className={`border-b border-line last:border-0 ${highlighted ? 'font-semibold' : ''}`}
                >
                  <th scope="row" className="py-1 pr-3 font-medium">
                    {row.metric.year}
                    {highlighted && <span className="sr-only"> (selected)</span>}
                  </th>
                  <td className="py-1 pr-3">{dateText(row.metric.sos_date)}</td>
                  <td className="py-1 pr-3">{dateText(row.metric.eos_date)}</td>
                  <td className="py-1">{row.length === null ? 'No data' : formatDays(row.length)}</td>
                </tr>
              )
            })}
          </tbody>
          {average && (
            <tfoot className="text-ink-muted">
              <tr className="border-t border-line-strong">
                <th scope="row" className="py-1 pr-3 font-medium">
                  Average
                </th>
                <td className="py-1 pr-3">
                  {formatDayMonth(dateFromDayOfYear(refYear, Math.round(average.sos)))}
                </td>
                <td className="py-1 pr-3">
                  {formatDayMonth(dateFromDayOfYear(refYear, Math.round(average.eos)))}
                </td>
                <td className="py-1">{formatDays(Math.round(average.length))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </figure>
  )
}

/** Beside the bar, on whichever side has more room, vertically centred on it. */
function tooltipPosition({
  cx,
  barWidth,
  width,
  mid,
}: {
  cx: number
  barWidth: number
  width: number
  mid: number
}): CSSProperties {
  const top = Math.min(Math.max(mid, 40), HEIGHT - 40)
  const gap = barWidth / 2 + 8
  return cx > width / 2 ? { right: width - cx + gap, top } : { left: cx + gap, top }
}

function Tooltip({ row, style }: { row: Row; style: CSSProperties }) {
  const { metric } = row
  return (
    <div
      role="tooltip"
      style={style}
      className="pointer-events-none absolute z-10 w-max -translate-y-1/2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-panel"
    >
      <p className="font-semibold text-ink">{metric.year}</p>
      {!metric.sos_date && !metric.eos_date ? (
        <p className="text-ink-muted">No data for this year</p>
      ) : (
        <dl className="mt-0.5 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
          <dt className="text-ink-muted">Start</dt>
          <dd className="text-ink">{dateText(metric.sos_date)}</dd>
          <dt className="text-ink-muted">End</dt>
          <dd className="text-ink">{dateText(metric.eos_date)}</dd>
          <dt className="text-ink-muted">Length</dt>
          <dd className="text-ink">{row.length === null ? 'No data' : formatDays(row.length)}</dd>
        </dl>
      )}
    </div>
  )
}
