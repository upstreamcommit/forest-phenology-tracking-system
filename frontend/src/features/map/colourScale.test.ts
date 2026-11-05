import { describe, expect, it } from 'vitest'

import {
  buildColourScale,
  CATEGORY_COLOURS,
  fitTicks,
  legendTickValues,
  NO_DATA_COLOUR,
  SEQUENTIAL_PALETTE,
  sequentialColour,
  type GradientLegend,
  type LegendData,
} from './colourScale'
import { COLOUR_DOMAINS, METRIC_KEYS, METRICS } from './metrics'

const FIRST = SEQUENTIAL_PALETTE[0]
const LAST = SEQUENTIAL_PALETTE[SEQUENTIAL_PALETTE.length - 1]

function gradient(legend: LegendData): GradientLegend {
  if (legend.kind !== 'gradient') throw new Error('expected a gradient legend')
  return legend
}

describe('sequentialColour', () => {
  it('hits palette stops, interpolates between them and clamps outside', () => {
    const domain = [0, 80] as const // one palette step per 10
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

  it('keeps interior ticks clear of the ends so labels never collide', () => {
    // 160 would sit a seventh of the bar from 150, where the two labels overlapped.
    expect(legendTickValues([150, 220])).toEqual([150, 180, 200, 220])
  })

  it('marks the fixed domains', () => {
    expect(legendTickValues(COLOUR_DOMAINS.season_length)).toEqual([120, 150, 180, 210, 240])
    expect(legendTickValues(COLOUR_DOMAINS.sos)).toEqual([70, 100, 120, 135])
    expect(legendTickValues(COLOUR_DOMAINS.eos)).toEqual([260, 280, 300, 315])
  })
})

describe('fitTicks', () => {
  const labels = (metric: 'season_length' | 'sos' | 'eos', width: number) =>
    fitTicks(gradient(buildColourScale({ metric, theme: 'light' }).legend).ticks, width).map(
      (t) => t.label,
    )

  it('drops interior labels that would collide in the 320px sidebar', () => {
    expect(labels('season_length', 320)).toEqual(['≤ 120 days', '180 days', '≥ 240 days'])
    // "30 Apr" would run into "≥ 15 May".
    expect(labels('sos', 320)).toEqual(['≤ 11 Mar', '10 Apr', '≥ 15 May'])
    expect(labels('eos', 320)).toEqual(['≤ 17 Sept', '7 Oct', '27 Oct', '≥ 11 Nov'])
  })

  it('keeps every label on a wide bar, and always both ends', () => {
    expect(labels('season_length', 640)).toHaveLength(5)
    expect(labels('season_length', 80)).toEqual(['≤ 120 days', '≥ 240 days'])
  })
})

describe('buildColourScale for numeric metrics', () => {
  it('builds a clamped interpolate expression over the fixed domain', () => {
    const scale = buildColourScale({
      metric: 'season_length',
      values: [10, 150, 200, 400],
      theme: 'light',
    })
    expect(scale.domain).toEqual([120, 240])

    const [op, test, interpolate, fallback] = scale.fillColor as unknown[]
    expect(op).toBe('case')
    expect(test).toEqual(['==', ['typeof', ['get', 'season_length']], 'number'])
    expect(fallback).toBe(NO_DATA_COLOUR.light)
    const stops = (interpolate as unknown[]).slice(3)
    expect(stops.slice(0, 2)).toEqual([120, FIRST])
    expect(stops.slice(-2)).toEqual([240, LAST])
    expect(stops).toHaveLength(SEQUENTIAL_PALETTE.length * 2)

    expect(scale.colourFor(10)).toBe(FIRST)
    expect(scale.colourFor(400)).toBe(LAST)
    expect(scale.colourFor(null)).toBe(NO_DATA_COLOUR.light)
  })

  it('uses one domain for every year, so a value has the same colour in each', () => {
    // An early year and a late one: a scale fitted to each would put 100 at opposite ends.
    const early = buildColourScale({ metric: 'sos', values: [80, 90, 100], theme: 'light' })
    const late = buildColourScale({ metric: 'sos', values: [100, 110, 120], theme: 'light' })

    expect(early.domain).toEqual(COLOUR_DOMAINS.sos)
    expect(late.domain).toEqual(early.domain)
    expect(late.colourFor(100)).toBe(early.colourFor(100))
    expect(late.fillColor).toEqual(early.fillColor)
    expect(late.legend).toEqual(early.legend)
  })

  it('covers the stored range of every numeric metric', () => {
    for (const key of METRIC_KEYS) {
      const definition = METRICS[key]
      if (definition.kind !== 'sequential') continue
      expect(buildColourScale({ metric: key, theme: 'light' }).domain).toEqual(definition.domain)
    }
    // The synthetic seed's extremes over 2016-2026.
    expect(COLOUR_DOMAINS.sos[0]).toBeLessThanOrEqual(72)
    expect(COLOUR_DOMAINS.sos[1]).toBeGreaterThanOrEqual(131)
    expect(COLOUR_DOMAINS.eos[0]).toBeLessThanOrEqual(267)
    expect(COLOUR_DOMAINS.eos[1]).toBeGreaterThanOrEqual(312)
    expect(COLOUR_DOMAINS.season_length[0]).toBeLessThanOrEqual(139)
    expect(COLOUR_DOMAINS.season_length[1]).toBeGreaterThanOrEqual(236)
  })

  it('marks the clamped ends in the legend and labels ticks in the metric unit', () => {
    const legend = gradient(buildColourScale({ metric: 'season_length', theme: 'light' }).legend)
    expect(legend.ticks.map((t) => t.label)).toEqual([
      '≤ 120 days',
      '150 days',
      '180 days',
      '210 days',
      '≥ 240 days',
    ])
    expect(legend.ticks[0].offset).toBe(0)
    expect(legend.ticks[2].offset).toBe(0.5)
    expect(legend.ticks[4].offset).toBe(1)
    expect(legend.stops[0]).toEqual({ offset: 0, colour: FIRST })
    expect(legend.stops[legend.stops.length - 1]).toEqual({ offset: 1, colour: LAST })
  })

  it('labels day-of-year ticks as dates of a non-leap year, the same in every year', () => {
    const legend = gradient(buildColourScale({ metric: 'sos', values: [90], theme: 'dark' }).legend)
    expect(legend.ticks.map((t) => t.label)).toEqual(['≤ 11 Mar', '10 Apr', '30 Apr', '≥ 15 May'])
  })

  it('adds a no-data entry only when loaded values are missing', () => {
    const scale = buildColourScale({ metric: 'eos', values: [280, null, 300], theme: 'dark' })
    expect(scale.legend.noData).toEqual({ label: 'No data', colour: NO_DATA_COLOUR.dark })
    expect(scale.colourFor(null)).toBe(NO_DATA_COLOUR.dark)

    expect(buildColourScale({ metric: 'eos', values: [280], theme: 'dark' }).legend.noData).toBe(
      null,
    )
    // Before a grid has loaded there is nothing to say about missing values.
    expect(buildColourScale({ metric: 'eos', theme: 'dark' }).legend.noData).toBeNull()
  })

  it('keeps the scale when no value exists, drawing every cell as no data', () => {
    const scale = buildColourScale({ metric: 'sos', values: [null, null], theme: 'light' })
    expect(scale.domain).toEqual(COLOUR_DOMAINS.sos)
    expect(scale.legend.kind).toBe('gradient')
    expect(scale.legend.noData).toEqual({ label: 'No data', colour: NO_DATA_COLOUR.light })
    expect(scale.colourFor(null)).toBe(NO_DATA_COLOUR.light)
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
