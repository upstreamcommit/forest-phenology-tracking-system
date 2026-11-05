import { useId } from 'react'

import type { GradientLegend, LegendData } from './colourScale'
import { METRICS, type MetricKey } from './metrics'

interface LegendProps {
  metric: MetricKey
  legend: LegendData
  /** Show the dashed outline of the area with NDVI curves. */
  showComputedArea: boolean
}

function Swatch({ colour }: { colour: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-3.5 shrink-0 rounded-sm ring-1 ring-inset ring-line-strong"
      style={{ backgroundColor: colour }}
    />
  )
}

function GradientScale({ legend }: { legend: GradientLegend }) {
  const gradient = legend.stops.map((s) => `${s.colour} ${s.offset * 100}%`).join(', ')
  const labels = legend.ticks.map((t) => t.label)
  const last = legend.ticks.length - 1

  return (
    <div>
      <p className="sr-only">
        Colours run from dark purple for {labels[0]} through green to yellow for {labels[last]}.
        Marked values: {labels.join(', ')}.
      </p>
      <div aria-hidden="true">
        <div
          className="h-3 rounded-sm ring-1 ring-inset ring-line"
          style={{ backgroundImage: `linear-gradient(to right, ${gradient})` }}
        />
        <div className="relative mt-1 h-4 text-xs text-ink-muted">
          {legend.ticks.map((tick, i) => (
            <span
              key={tick.value}
              className={`absolute top-0 whitespace-nowrap tabular-nums ${
                i === 0 ? '' : i === last ? '-translate-x-full' : '-translate-x-1/2'
              }`}
              style={{ left: `${tick.offset * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Key to the map colours for the current metric, with every colour also named in text. */
export function Legend({ metric, legend, showComputedArea }: LegendProps) {
  const headingId = useId()
  const hasItems = legend.kind === 'categories' || legend.noData !== null || showComputedArea

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-xs font-medium text-ink-muted">
        <span className="sr-only">Legend:</span> {METRICS[metric].label}
      </h2>

      {legend.kind === 'gradient' && <GradientScale legend={legend} />}
      {legend.kind === 'empty' && (
        <p className="text-sm text-ink-muted">No cell has a value for this metric.</p>
      )}

      {hasItems && (
        <ul className="flex flex-col gap-1 text-sm text-ink">
          {legend.kind === 'categories' &&
            legend.items.map((item) => (
              <li key={item.value} className="flex items-center gap-2">
                <Swatch colour={item.colour} />
                {item.label}
              </li>
            ))}
          {legend.noData && (
            <li className="flex items-center gap-2">
              <Swatch colour={legend.noData.colour} />
              {legend.noData.label}
            </li>
          )}
          {showComputedArea && (
            <li className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block size-3.5 shrink-0 border-2 border-dashed border-ink"
              />
              <span>
                <span className="sr-only">Dashed outline:</span> NDVI curves available
              </span>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
