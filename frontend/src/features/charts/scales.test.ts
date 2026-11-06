import { describe, expect, it } from 'vitest'

import { linearScale, MONTH_LABELS, monthTicks, niceTicks } from './scales'

describe('linearScale', () => {
  it('maps the domain onto the range, including a reversed SVG y range', () => {
    const x = linearScale([0, 10], [0, 200])
    expect(x(0)).toBe(0)
    expect(x(5)).toBe(100)
    expect(x(10)).toBe(200)
    expect(x(12.5)).toBe(250)

    const y = linearScale([100, 300], [160, 10])
    expect(y(100)).toBe(160)
    expect(y(300)).toBe(10)
    expect(y(200)).toBe(85)
  })

  it('inverts range values back to the domain', () => {
    const y = linearScale([100, 300], [160, 10])
    expect(y.invert(160)).toBe(100)
    expect(y.invert(85)).toBe(200)
    for (const value of [100, 137, 251.5, 300]) expect(y.invert(y(value))).toBeCloseTo(value, 10)
  })

  it('exposes its domain and range', () => {
    const scale = linearScale([1, 2], [3, 4])
    expect(scale.domain).toEqual([1, 2])
    expect(scale.range).toEqual([3, 4])
  })

  it('maps a zero-width domain or range to the midpoint instead of NaN', () => {
    expect(linearScale([5, 5], [0, 100])(5)).toBe(50)
    expect(linearScale([0, 10], [40, 40]).invert(40)).toBe(5)
  })
})

describe('niceTicks', () => {
  it('steps by round numbers', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(0, 10, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(niceTicks(-7, 23, 5)).toEqual([-5, 0, 5, 10, 15, 20])
    expect(niceTicks(0, 1000, 2)).toEqual([0, 500, 1000])
  })

  it('keeps decimal ticks exact and inside the range', () => {
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
    expect(niceTicks(0.3, 0.9, 6)).toEqual([0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])
    expect(niceTicks(0.12, 0.31, 4)).toEqual([0.15, 0.2, 0.25, 0.3])
  })

  it('only uses steps of 1, 2 or 5 times a power of ten, near the requested count', () => {
    const ranges: [number, number, number][] = [
      [0, 0.83, 5],
      [12, 9876, 6],
      [-3.3, 41, 4],
      [0.001, 0.0047, 5],
      [250, 290, 8],
    ]
    for (const [min, max, count] of ranges) {
      const ticks = niceTicks(min, max, count)
      const step = ticks[1] - ticks[0]
      const mantissa = step / 10 ** Math.floor(Math.log10(step))
      expect([1, 2, 5].some((m) => Math.abs(mantissa - m) < 1e-6)).toBe(true)
      expect(ticks.length).toBeGreaterThanOrEqual(Math.floor(count / 2))
      expect(ticks.length).toBeLessThanOrEqual(count * 2 + 1)
      expect(ticks[0]).toBeGreaterThanOrEqual(min)
      expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(max)
    }
  })

  it('handles reversed, empty and invalid ranges', () => {
    expect(niceTicks(100, 0, 5)).toEqual(niceTicks(0, 100, 5))
    expect(niceTicks(5, 5)).toEqual([5])
    expect(niceTicks(Number.NaN, 1)).toEqual([])
    expect(niceTicks(0, Number.POSITIVE_INFINITY)).toEqual([])
    expect(niceTicks(0, 1, 0)).toEqual([])
  })
})

describe('monthTicks', () => {
  it('gives the day of year of the 1st of each month', () => {
    expect(monthTicks(2023)).toEqual([1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335])
  })

  it('shifts March onwards by a day in leap years', () => {
    expect(monthTicks(2024)).toEqual([1, 32, 61, 92, 122, 153, 183, 214, 245, 275, 306, 336])
    expect(monthTicks(2000)[2]).toBe(61)
    // 1900 is divisible by 4 but not a leap year.
    expect(monthTicks(1900)[2]).toBe(60)
  })

  it('has a short label for every month', () => {
    expect(MONTH_LABELS).toHaveLength(12)
    expect(MONTH_LABELS[0]).toBe('Jan')
    expect(MONTH_LABELS[11]).toBe('Dec')
  })
})
