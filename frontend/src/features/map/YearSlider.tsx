import { useId } from 'react'

import { Button } from '../../components/Button'

interface YearSliderProps {
  /** Selectable years, ascending. */
  years: number[]
  value: number
  onChange: (year: number) => void
}

/**
 * Picks one of the stored years. The range input steps through the list by index, so gaps
 * between years are skipped; the buttons step one stored year at a time.
 */
export function YearSlider({ years, value, onChange }: YearSliderProps) {
  const inputId = useId()
  const index = Math.max(0, years.indexOf(value))
  const previous = years[index - 1]
  const next = years[index + 1]

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label htmlFor={inputId} className="text-xs font-medium text-ink-muted">
          Year
        </label>
        <span aria-hidden="true" className="text-lg font-semibold tabular-nums text-ink">
          {value}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          className="px-2"
          aria-label="Previous year"
          title="Previous year"
          disabled={previous === undefined}
          onClick={() => previous !== undefined && onChange(previous)}
        >
          <span aria-hidden="true">‹</span>
        </Button>
        <input
          id={inputId}
          type="range"
          min={0}
          max={Math.max(0, years.length - 1)}
          step={1}
          value={index}
          aria-valuetext={String(value)}
          onChange={(event) => {
            const year = years[Number(event.target.value)]
            if (year !== undefined) onChange(year)
          }}
          className="min-w-0 flex-1 accent-accent"
        />
        <Button
          variant="ghost"
          className="px-2"
          aria-label="Next year"
          title="Next year"
          disabled={next === undefined}
          onClick={() => next !== undefined && onChange(next)}
        >
          <span aria-hidden="true">›</span>
        </Button>
      </div>
      <div aria-hidden="true" className="flex justify-between px-9 text-xs text-ink-subtle">
        <span>{years[0]}</span>
        <span>{years[years.length - 1]}</span>
      </div>
    </div>
  )
}
