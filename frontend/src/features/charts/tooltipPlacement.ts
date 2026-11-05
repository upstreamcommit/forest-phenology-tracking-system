/** A vertical extent, in viewport pixels. */
export interface Span {
  top: number
  bottom: number
}

export type TooltipSide = 'above' | 'below'

const CLIPS = /^(auto|scroll|hidden|clip)$/

/** How many pixels of top..bottom lie inside `view`. */
function shown(top: number, bottom: number, view: Span): number {
  return Math.max(0, Math.min(bottom, view.bottom) - Math.max(top, view.top))
}

/**
 * Where a tooltip goes when the plot reserves a `band` pixels high band above and below it: above
 * when that band is wholly in `view`, otherwise below when more of the lower band shows.
 */
export function tooltipSide(plot: Span, view: Span, band: number): TooltipSide {
  const above = shown(plot.top - band, plot.top, view)
  // Half a pixel of slack for fractional layout.
  if (above >= band - 0.5) return 'above'
  return shown(plot.bottom, plot.bottom + band, view) > above ? 'below' : 'above'
}

/**
 * The part of the viewport, top to bottom, that `element`'s scroll containers and other clipping
 * ancestors leave visible.
 */
export function visibleSpan(element: Element): Span {
  let top = 0
  let bottom = document.documentElement.clientHeight || window.innerHeight
  let node = element.parentElement
  for (; node && node !== document.body; node = node.parentElement) {
    if (!CLIPS.test(getComputedStyle(node).overflowY)) continue
    const edge = node.getBoundingClientRect().top + node.clientTop
    top = Math.max(top, edge)
    bottom = Math.min(bottom, edge + node.clientHeight)
  }
  return { top, bottom }
}
