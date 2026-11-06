import { useId, useRef } from 'react'

import { Button } from '../../components/Button'
import { useDraft } from '../../lib/useDraft'
import {
  formatThreshold,
  snapThreshold,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  THRESHOLD_STEP,
} from './pointParams'

export interface ThresholdControlProps {
  /** The selected threshold, as a fraction of the seasonal amplitude. */
  value: number
  /** The catalog's default, which Reset goes back to. */
  defaultValue: number
  onChange: (value: number) => void
  onReset: () => void
  /** Id of the text that explains the threshold method. */
  describedBy?: string
}

/** The season threshold: a slider in steps of 5% of the seasonal amplitude, and a reset. */
export function ThresholdControl({
  value,
  defaultValue,
  onChange,
  onReset,
  describedBy,
}: ThresholdControlProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  // The value comes back through the URL a moment later; the draft keeps quick key presses.
  const [shown, setShown] = useDraft(value)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label htmlFor={inputId} className="text-xs font-medium text-ink-muted">
          Season threshold
        </label>
        <span aria-hidden="true" className="text-sm font-semibold tabular-nums text-ink">
          {formatThreshold(shown)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="range"
          min={THRESHOLD_MIN}
          max={THRESHOLD_MAX}
          step={THRESHOLD_STEP}
          value={shown}
          aria-valuetext={`${formatThreshold(shown)} of the seasonal amplitude`}
          aria-describedby={describedBy}
          onChange={(event) => {
            const next = snapThreshold(Number(event.target.value))
            if (!Number.isFinite(next)) return
            setShown(next)
            onChange(next)
          }}
          className="min-w-0 flex-1 accent-accent"
        />
        <Button
          variant="ghost"
          aria-label={`Reset the threshold to ${formatThreshold(defaultValue)}`}
          disabled={shown === defaultValue}
          onClick={() => {
            // The button disables itself at the default, so keep focus on the control.
            inputRef.current?.focus()
            setShown(defaultValue)
            onReset()
          }}
        >
          Reset
        </Button>
      </div>
    </div>
  )
}
