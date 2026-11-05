import { useCallback, useState } from 'react'

/**
 * The content width of an element, kept current with a ResizeObserver. Attach the returned
 * callback ref to the element. `fallback` is used until a real width is known (and in jsdom,
 * which has no layout).
 */
export function useElementWidth<T extends HTMLElement>(fallback: number) {
  const [width, setWidth] = useState(fallback)

  const ref = useCallback((element: T | null) => {
    if (!element) return
    const update = (next: number) => {
      if (next > 0) setWidth(Math.floor(next))
    }
    // Measuring in the ref callback renders the real width before the first paint.
    update(element.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => update(entries[0]?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}
