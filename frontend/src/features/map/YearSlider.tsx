import { useId } from 'react'

import { Button } from '../../components/Button'
import { useDraft } from '../../lib/useDraft'

interface YearSliderProps {
  /** Selectable years, ascending. */
  years: number[]
  value: number
  onChange: (year: number) => void
}

// The end buttons stay focusable when they cannot move further (aria-disabled rather than
// disabled), so focus is not lost when a press reaches the first or last year.
const STEP_BUTTON = 'px-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50'

/**
 * Picks one of the stored years. The range input steps through the list by index, so gaps
 * between years are skipped; the buttons step one stored year at a time. The year shown follows
 * each change at once, while `value` (the URL) catches up.
 */
export function YearSlider({ years, value, onChange }: YearSliderProps) {
  const inputId = useId()
  const [year, setYear] = useDraft(value)
  const index = Math.max(0, years.indexOf(year))
  const previous = years[index - 1]
  const next = years[index + 1]

  const choose = (target: number | undefined) => {
    if (target === undefined || target === year) return
    setYear(target)
    onChange(target)
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label htmlFor={inputId} className="text-xs font-medium text-ink-muted">
          Year
        </label>
        <span aria-hidden="true" className="text-lg font-semibold tabular-nums text-ink">
          {year}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          className={STEP_BUTTON}
          aria-label="Previous year"
          title="Previous year"
          aria-disabled={previous === undefined}
          onClick={() => choose(previous)}
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
          aria-valuetext={String(year)}
          onChange={(event) => choose(years[Number(event.target.value)])}
          className="min-w-0 flex-1 accent-accent"
        />
        <Button
          variant="ghost"
          className={STEP_BUTTON}
          aria-label="Next year"
          title="Next year"
          aria-disabled={next === undefined}
          onClick={() => choose(next)}
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
