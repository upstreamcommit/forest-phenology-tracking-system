import { describe, expect, it } from 'vitest'

import {
  buildColourScale,
  CATEGORY_COLOURS,
  legendTickValues,
  NO_DATA_COLOUR,
  quantile,
  robustDomain,
  SEQUENTIAL_PALETTE,
  sequentialColour,
} from './colourScale'

const FIRST = SEQUENTIAL_PALETTE[0]
const LAST = SEQUENTIAL_PALETTE[SEQUENTIAL_PALETTE.length - 1]

describe('quantile', () => {
  it('interpolates linearly between ranks', () => {
    const sorted = [1, 2, 3, 4, 5]
    expect(quantile(sorted, 0)).toBe(1)
    expect(quantile(sorted, 0.25)).toBe(2)
    expect(quantile(sorted, 0.5)).toBe(3)
    expect(quantile(sorted, 0.9)).toBeCloseTo(4.6)
    expect(quantile(sorted, 1)).toBe(5)
    expect(quantile([], 0.5)).toBeNaN()
  })
})

describe('robustDomain', () => {
  it('rounds the 2nd-98th percentile outward to 5 days for narrow spreads', () => {
    // p2 = 101.36, p98 = 118.64
    expect(robustDomain([101, 119])).toEqual([100, 120])
  })

  it('rounds to 10 days when the spread is wider than 50 days', () => {
    // p2 = 124.08, p98 = 175.92
    expect(robustDomain([123, 177])).toEqual([120, 180])
  })

  it('ignores a few outliers', () => {
    const typical = Array.from({ length: 99 }, (_, i) => 121 + (i % 19))
    expect(robustDomain([10, ...typical, 400])).toEqual([120, 140])
  })

  it('keeps a non-empty range when every value is the same', () => {
    expect(robustDomain([150, 150, 150])).toEqual([150, 155])
  })

  it('skips nulls and has no domain without values', () => {
    expect(robustDomain([null, 101, null, 119])).toEqual([100, 120])
    expect(robustDomain([null, null])).toBeNull()
    expect(robustDomain([])).toBeNull()
  })
})

describe('sequentialColour', () => {
  it('hits palette stops, interpolates between them and clamps outside', () => {
    const domain: [number, number] = [0, 80] // one palette step per 10
    expect(sequentialColour(0, domain)).toBe(FIRST)
    expect(sequentialColour(10, domain)).toBe(SEQUENTIAL_PALETTE[1])
    expect(sequentialColour(5, domain)).toBe('#461768')
    expect(sequentialColour(80, domain)).toBe(LAST)
    expect(sequentialColour(-50, domain)).toBe(FIRST)
    expect(sequentialColour(500, domain)).toBe(LAST)
  })
})

describe('legendTickValues', () => {
  it('labels both ends and up to three round values between them', () => {
    expect(legendTickValues([60, 200])).toEqual([60, 100, 150, 200])
    expect(legendTickValues([80, 120])).toEqual([80, 90, 100, 110, 120])
    expect(legendTickValues([150, 155])).toEqual([150, 155])
  })
})

describe('buildColourScale for numeric metrics', () => {
  const typical = Array.from({ length: 99 }, (_, i) => 121 + (i % 19))

  it('builds a clamped interpolate expression over the robust domain', () => {
    const scale = buildColourScale({
      metric: 'season_length',
      values: [10, ...typical, 400],
      theme: 'light',
    })
    expect(scale.domain).toEqual([120, 140])

    const [op, test, interpolate, fallback] = scale.fillColor as unknown[]
    expect(op).toBe('case')
    expect(test).toEqual(['==', ['typeof', ['get', 'season_length']], 'number'])
    expect(fallback).toBe(NO_DATA_COLOUR.light)
    const stops = (interpolate as unknown[]).slice(3)
    expect(stops.slice(0, 2)).toEqual([120, FIRST])
    expect(stops.slice(-2)).toEqual([140, LAST])
    expect(stops).toHaveLength(SEQUENTIAL_PALETTE.length * 2)

    expect(scale.colourFor(10)).toBe(FIRST)
    expect(scale.colourFor(400)).toBe(LAST)
    expect(scale.colourFor(null)).toBe(NO_DATA_COLOUR.light)
  })

  it('marks clamped ends in the legend and labels ticks in the metric unit', () => {
    const scale = buildColourScale({
      metric: 'season_length',
      values: [10, ...typical, 400],
      theme: 'light',
    })
    if (scale.legend.kind !== 'gradient') throw new Error('expected a gradient legend')
    expect(scale.legend.clampedLow).toBe(true)
    expect(scale.legend.clampedHigh).toBe(true)
    expect(scale.legend.ticks.map((t) => t.label)).toEqual([
      '≤ 120 days',
      '125 days',
      '130 days',
      '135 days',
      '≥ 140 days',
    ])
    expect(scale.legend.ticks[0].offset).toBe(0)
    expect(scale.legend.ticks[4].offset).toBe(1)
    expect(scale.legend.stops[0]).toEqual({ offset: 0, colour: FIRST })
    expect(scale.legend.noData).toBeNull()
  })

  it('labels day-of-year ticks as dates of the given year', () => {
    const scale = buildColourScale({ metric: 'sos', values: [90, 120], theme: 'dark', year: 2021 })
    if (scale.legend.kind !== 'gradient') throw new Error('expected a gradient legend')
    expect(scale.legend.clampedLow).toBe(false)
    expect(scale.legend.ticks.map((t) => t.label)).toEqual([
      '31 Mar',
      '10 Apr',
      '20 Apr',
      '30 Apr',
    ])
  })

  it('adds a no-data entry when some values are missing', () => {
    const scale = buildColourScale({ metric: 'eos', values: [280, null, 300], theme: 'dark' })
    expect(scale.legend.noData).toEqual({ label: 'No data', colour: NO_DATA_COLOUR.dark })
    expect(scale.colourFor(null)).toBe(NO_DATA_COLOUR.dark)
  })

  it('paints everything as no data when no value exists', () => {
    const scale = buildColourScale({ metric: 'sos', values: [null, null], theme: 'light' })
    expect(scale.domain).toBeNull()
    expect(scale.legend.kind).toBe('empty')
    expect(scale.fillColor).toEqual(['to-color', NO_DATA_COLOUR.light])
    expect(scale.colourFor(120)).toBe(NO_DATA_COLOUR.light)
  })
})

describe('buildColourScale for forest', () => {
  it('uses two category colours per theme', () => {
    for (const theme of ['light', 'dark'] as const) {
      const { forest, open } = CATEGORY_COLOURS[theme]
      const scale = buildColourScale({ metric: 'forest', values: [1, 0, 1], theme })
      expect(scale.domain).toBeNull()
      expect(scale.fillColor).toEqual([
        'match',
        ['get', 'forest'],
        1,
        forest,
        0,
        open,
        NO_DATA_COLOUR[theme],
      ])
      expect(scale.legend).toEqual({
        kind: 'categories',
        items: [
          { value: 1, label: 'Forest', colour: forest },
          { value: 0, label: 'Open land', colour: open },
        ],
        noData: null,
      })
      expect(scale.colourFor(1)).toBe(forest)
      expect(scale.colourFor(0)).toBe(open)
      expect(scale.colourFor(null)).toBe(NO_DATA_COLOUR[theme])
    }
    expect(CATEGORY_COLOURS.light).not.toEqual(CATEGORY_COLOURS.dark)
  })
})

describe('legendTickValues spacing', () => {
  it('keeps interior ticks clear of the ends so labels never collide', () => {
    // 160 would sit a seventh of the bar from 150, where the two labels overlapped.
    expect(legendTickValues([150, 220])).toEqual([150, 180, 200, 220])
  })
})
