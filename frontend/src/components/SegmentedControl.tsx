import { useId, useRef, type KeyboardEvent } from 'react'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  /** Longer text for screen readers and the tooltip. */
  description?: string
}

interface SegmentedControlProps<T extends string> {
  label: string
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Hide the visible label (it stays available to assistive technology). */
  hideLabel?: boolean
}

/**
 * A single choice from a few options, as an ARIA radiogroup: Tab enters and leaves it, the arrow
 * keys move and select, as with native radio buttons.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  hideLabel = false,
}: SegmentedControlProps<T>) {
  const labelId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (step === 0) return
    event.preventDefault()
    const next = (index + step + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className={hideLabel ? 'sr-only' : 'text-xs font-medium text-ink-muted'}>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="inline-flex flex-wrap gap-0.5 rounded-lg bg-surface-sunken p-0.5 ring-1 ring-inset ring-line"
      >
        {options.map((option, index) => {
          const checked = option.value === value
          // The checked fill stands out from the track by over 3:1 in both themes.
          return (
            <button
              key={option.value}
              ref={(el) => {
                refs.current[index] = el
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-description={option.description}
              title={option.description}
              tabIndex={checked ? 0 : -1}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${
                checked
                  ? 'bg-accent text-accent-ink shadow-sm'
                  : 'text-ink-muted hover:bg-surface hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
