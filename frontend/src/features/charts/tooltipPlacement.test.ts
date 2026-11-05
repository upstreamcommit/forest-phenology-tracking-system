import { afterEach, describe, expect, it, vi } from 'vitest'

import { tooltipSide, visibleSpan } from './tooltipPlacement'

const BAND = 28

describe('tooltipSide', () => {
  const view = { top: 100, bottom: 600 }
  const plot = (top: number) => ({ top, bottom: top + 180 })

  it('puts the tooltip above the plot while the whole band above it is in view', () => {
    expect(tooltipSide(plot(300), view, BAND)).toBe('above')
    expect(tooltipSide(plot(128), view, BAND)).toBe('above')
    // Half a pixel of fractional layout still counts as in view.
    expect(tooltipSide(plot(127.6), view, BAND)).toBe('above')
    // The plot running off the bottom of the view leaves the band above it in view.
    expect(tooltipSide(plot(560), view, BAND)).toBe('above')
  })

  it('puts it below once any of the band above is hidden and the band below shows', () => {
    expect(tooltipSide(plot(127), view, BAND)).toBe('below')
    expect(tooltipSide(plot(105), view, BAND)).toBe('below')
    // The plot's own top scrolled out of view, as long as some of it shows.
    expect(tooltipSide(plot(-60), view, BAND)).toBe('below')
  })

  it('keeps the band that shows more when the view is too short for either', () => {
    const short = { top: 100, bottom: 300 }
    expect(tooltipSide(plot(110), short, BAND)).toBe('above')
    expect(tooltipSide(plot(105), short, BAND)).toBe('below')
    expect(tooltipSide(plot(1000), short, BAND)).toBe('above')
  })
})

describe('visibleSpan', () => {
  afterEach(() => document.body.replaceChildren())

  function box(parent: HTMLElement, overflowY: string, rect: { top: number; height: number }) {
    const element = document.createElement('div')
    element.style.overflowY = overflowY
    Object.defineProperty(element, 'clientTop', { value: 1 })
    Object.defineProperty(element, 'clientHeight', { value: rect.height })
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, rect.top, 300, rect.height + 2),
    )
    parent.append(element)
    return element
  }

  it('is the viewport when nothing clips', () => {
    const plot = document.createElement('div')
    box(document.body, 'visible', { top: -500, height: 50 }).append(plot)
    expect(visibleSpan(plot)).toEqual({ top: 0, bottom: window.innerHeight })
  })

  it('is what every clipping ancestor and the viewport leave in view', () => {
    // A page that clips at 60 to 700, a scroll container at 100 to 1100, and a box that doesn't
    // clip, inside the viewport (jsdom's is 768px high).
    const page = box(document.body, 'hidden', { top: 60, height: 640 })
    const scroller = box(page, 'auto', { top: 100, height: 1000 })
    const plain = box(scroller, 'visible', { top: 0, height: 10 })
    const plot = document.createElement('div')
    plain.append(plot)
    expect(visibleSpan(plot)).toEqual({ top: 101, bottom: 701 })
    expect(visibleSpan(scroller)).toEqual({ top: 61, bottom: 701 })

    const tall = box(document.body, 'scroll', { top: -100, height: 2000 })
    const inside = document.createElement('div')
    tall.append(inside)
    expect(visibleSpan(inside)).toEqual({ top: 0, bottom: window.innerHeight })
  })
})
