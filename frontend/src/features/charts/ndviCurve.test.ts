import { describe, expect, it } from 'vitest'

import type { NdviCurve } from '../../api/types'
import { dateFromDayOfYear } from '../../lib/dates'
import { ndviCurveFor } from '../../test/fixtures'
import {
  describeObservation,
  describeRelation,
  describeStored,
  estimateTextWidth,
  justBeside,
  lineSegments,
  ndviAxis,
  ndviDecimals,
  placeThresholdLabel,
  seasonEdge,
  segmentHits,
  summariseCurve,
  thresholdDecimals,
  type Box,
} from './ndviCurve'

// The fixture point (51.5, -0.5) in 2021: NDVI 0.18 to 0.73, threshold 0.45, a computed season
// from 7 Apr (DOY 97) to 16 Oct (DOY 289).
const CURVE = ndviCurveFor(51.5, -0.5, 2021)
const DOYS = CURVE.observations.map((obs) => obs.doy)

/** A 2026 curve with the given value on each of the fixture's composites. */
function curveOf(
  values: (number | null)[],
  threshold: number | null,
  sos: number | null,
  eos: number | null,
): NdviCurve {
  return {
    ...CURVE,
    year: 2026,
    observations: DOYS.map((doy, i) => ({
      doy,
      date: dateFromDayOfYear(2026, doy),
      ndvi: values[i] ?? null,
    })),
    threshold_ndvi: threshold,
    sos_date: sos === null ? null : dateFromDayOfYear(2026, sos),
    eos_date: eos === null ? null : dateFromDayOfYear(2026, eos),
    season_length: sos === null || eos === null ? null : eos - sos,
  }
}

/** Values that stay above 0.2 from the first composite to the last. */
const ALL_ABOVE = DOYS.map((_, i) => 0.21 + 0.2 * Math.sin((Math.PI * i) / 22))

/** A small seeded random generator (mulberry32), so a failing case can be replayed. */
function random(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('ndviAxis', () => {
  it('pads the data and threshold out to whole ticks within 0 to 1', () => {
    expect(ndviAxis(CURVE)).toEqual({
      domain: [0, 0.8],
      ticks: [0, 0.2, 0.4, 0.6, 0.8],
      decimals: 1,
    })
  })

  it('keeps values outside 0 to 1 in view', () => {
    const axis = ndviAxis({
      observations: [
        { doy: 1, date: '2021-01-01', ndvi: -0.12 },
        { doy: 17, date: '2021-01-17', ndvi: 0.4 },
      ],
      threshold_ndvi: null,
    })
    expect(axis.domain[0]).toBeLessThanOrEqual(-0.12)
    expect(axis.domain[1]).toBeGreaterThanOrEqual(0.4)
    expect(axis.domain[1]).toBeLessThanOrEqual(1)
  })

  it('stops the padding at 0 and 1', () => {
    const near = (lo: number, hi: number) =>
      ndviAxis({
        observations: [
          { doy: 1, date: '2021-01-01', ndvi: lo },
          { doy: 17, date: '2021-01-17', ndvi: hi },
        ],
        threshold_ndvi: null,
      }).domain
    expect(near(0.02, 0.5)).toEqual([0, 0.6])
    expect(near(0.5, 0.98)).toEqual([0.4, 1])
  })

  it('falls back to 0 to 1 when there are no values', () => {
    expect(ndviAxis({ observations: [], threshold_ndvi: null })).toEqual({
      domain: [0, 1],
      ticks: [0, 0.2, 0.4, 0.6, 0.8, 1],
      decimals: 1,
    })
  })

  // Ranges where picking the step again for the widened range left an edge without a tick.
  it.each([
    [0.134678, 0.578113],
    [0.428333, 0.439377],
    [0.928235, 0.946624],
    // Padded to 0.584 to 0.82, which snaps to 0.55 to 0.85 by 0.05; 0.1 suits that range better.
    [0.634, 0.77],
  ])('puts a tick on both edges of the plot for NDVI %f to %f', (min, max) => {
    const axis = ndviAxis({
      observations: [
        { doy: 1, date: '2021-01-01', ndvi: min },
        { doy: 17, date: '2021-01-17', ndvi: max },
      ],
      threshold_ndvi: (min + max) / 2,
    })
    expect(axis.ticks[0]).toBe(axis.domain[0])
    expect(axis.ticks.at(-1)).toBe(axis.domain[1])
  })

  it('has a tick on each edge and evenly spaced, distinct labels for any series', () => {
    const next = random(20261105)
    for (let run = 0; run < 3000; run++) {
      const lo = -0.3 + 1.25 * next()
      const span = 10 ** (-3 + 3.1 * next())
      const values = DOYS.map(() => (next() < 0.1 ? null : lo + span * next()))
      const present = values.filter((v): v is number => v !== null)
      const threshold =
        present.length === 0 || next() < 0.1
          ? null
          : Math.min(...present) + next() * (Math.max(...present) - Math.min(...present))
      const axis = ndviAxis(curveOf(values, threshold, null, null))
      const all = threshold === null ? present : [...present, threshold]
      const where = `run ${run}: ${JSON.stringify({ values, threshold, axis })}`

      expect(axis.ticks[0], where).toBe(axis.domain[0])
      expect(axis.ticks.at(-1), where).toBe(axis.domain[1])
      expect(axis.ticks.length, where).toBeGreaterThanOrEqual(3)
      expect(axis.ticks.length, where).toBeLessThanOrEqual(9)
      for (const value of all) {
        expect(value, where).toBeGreaterThanOrEqual(axis.domain[0])
        expect(value, where).toBeLessThanOrEqual(axis.domain[1])
      }
      // Padding stops at 0 and 1.
      if (all.length > 0 && Math.min(...all) >= 0) {
        expect(axis.domain[0], where).toBeGreaterThanOrEqual(0)
      }
      if (all.length > 0 && Math.max(...all) <= 1) {
        expect(axis.domain[1], where).toBeLessThanOrEqual(1)
      }
      const step = axis.ticks[1] - axis.ticks[0]
      axis.ticks.slice(1).forEach((tick, i) => {
        expect(tick - axis.ticks[i], where).toBeCloseTo(step, 9)
      })
      const labels = axis.ticks.map((tick) => tick.toFixed(axis.decimals))
      expect(new Set(labels).size, where).toBe(labels.length)
      expect(labels.map(Number), where).toEqual(axis.ticks)
    }
  })
})

describe('lineSegments', () => {
  it('breaks the line at missing values', () => {
    const curve = curveOf([0.2, 0.3, null, 0.4, null, null, 0.5], 0.3, 17, 97)
    const segments = lineSegments(curve.observations)
    expect(segments.map((segment) => segment.map((p) => p.doy))).toEqual([[1, 17], [49], [97]])
  })
})

describe('ndviDecimals and thresholdDecimals', () => {
  it('uses two decimals unless the value and threshold would look the same but differ', () => {
    expect(ndviDecimals(0.18, 0.45)).toBe(2)
    expect(ndviDecimals(0.45, 0.45)).toBe(2)
    expect(ndviDecimals(0.45, null)).toBe(2)
    // Both show as 0.41 with two decimals.
    expect(ndviDecimals(0.405426, 0.405996)).toBe(3)
    expect(ndviDecimals(0.4056, 0.4054)).toBe(3)
  })

  it('stops at three decimals, even where those still show the two as equal', () => {
    expect(ndviDecimals(0.40541, 0.40549)).toBe(3)
    expect(ndviDecimals(0.4054261, 0.4054262)).toBe(3)
    // As the API answers for (51.1, -0.4) in 2021 at an 85% threshold.
    expect(ndviDecimals(0.703951, 0.703953)).toBe(3)
  })

  it('gives the threshold the decimals its closest observation needs, up to three', () => {
    expect(thresholdDecimals(CURVE)).toBe(2)
    expect(thresholdDecimals(curveOf([0.2, 0.405426, null, 0.7], 0.405996, 17, 49))).toBe(3)
    expect(thresholdDecimals(curveOf([0.2, 0.703951, null, 0.75], 0.703953, 17, 49))).toBe(3)
    expect(thresholdDecimals(curveOf([0.2, 0.7], null, null, null))).toBe(2)
  })
})

describe('describeRelation and describeObservation', () => {
  it('names the composite, its value, its place against the threshold and its season edge', () => {
    expect(describeObservation('2021-01-17', 0.180118, 0.454977, null)).toBe(
      '17 Jan: NDVI 0.18, below the threshold',
    )
    expect(describeObservation('2021-04-07', 0.515125, 0.454977, 'start of season')).toBe(
      '7 Apr: NDVI 0.52, above the threshold, start of season',
    )
    expect(describeObservation('2021-04-07', 0.45, 0.45, 'start and end of season')).toBe(
      '7 Apr: NDVI 0.45, at the threshold, start and end of season',
    )
    expect(describeObservation('2021-01-17', 0.3, null, null)).toBe('17 Jan: NDVI 0.30')
  })

  it('shows both values to three decimals when two would show them equal', () => {
    expect(describeRelation(0.405426, 0.405996)).toBe('below the threshold of 0.406')
    expect(describeRelation(0.4056, 0.4054)).toBe('above the threshold of 0.405')
    expect(describeRelation(0.18, 0.45)).toBe('below the threshold')
    expect(describeRelation(0.18, null)).toBeNull()
    expect(describeObservation('2021-11-01', 0.405426, 0.405996, null)).toBe(
      '1 Nov: NDVI 0.405, below the threshold of 0.406',
    )
  })

  it('leaves the threshold out when asked, as the tooltip does', () => {
    expect(describeRelation(0.405426, 0.405996, false)).toBe('below the threshold')
    expect(describeRelation(0.4056, 0.4054, false)).toBe('above the threshold')
  })

  it('says "just" below or above where three decimals still show the two the same', () => {
    expect(justBeside(0.703951, 0.703953)).toBe(true)
    expect(justBeside(0.703953, 0.703953)).toBe(false)
    expect(justBeside(0.7034, 0.703953)).toBe(false)
    expect(justBeside(0.7, null)).toBe(false)
    expect(describeRelation(0.703951, 0.703953)).toBe('just below the threshold')
    expect(describeRelation(0.208235, 0.20754)).toBe('just above the threshold')
    expect(describeRelation(0.703953, 0.703953)).toBe('at the threshold')
    expect(describeObservation('2021-10-16', 0.703951, 0.703953, null)).toBe(
      '16 Oct: NDVI 0.704, just below the threshold',
    )
    expect(describeObservation('2021-12-03', 0.208235, 0.20754, 'end of season')).toBe(
      '3 Dec: NDVI 0.208, just above the threshold, end of season',
    )
  })
})

describe('seasonEdge', () => {
  it('marks the composites the computed start and end land on', () => {
    expect(seasonEdge(97, CURVE)).toBe('start of season')
    expect(seasonEdge(289, CURVE)).toBe('end of season')
    expect(seasonEdge(113, CURVE)).toBeNull()
    expect(seasonEdge(193, { sos_date: '2021-07-12', eos_date: '2021-07-12' })).toBe(
      'start and end of season',
    )
    expect(seasonEdge(97, { sos_date: null, eos_date: null })).toBeNull()
  })
})

describe('summariseCurve', () => {
  it('says when NDVI rises above the threshold and falls below it', () => {
    expect(summariseCurve(CURVE)).toBe(
      'NDVI rises above the threshold on 7 Apr and falls below it after 16 Oct, a 192-day season.',
    )
  })

  it('says NDVI is already above the threshold when the season starts at the first one', () => {
    const values = ALL_ABOVE.map((v, i) => (i > 17 ? 0.1 : v))
    expect(summariseCurve(curveOf(values, 0.2, 1, 273))).toBe(
      'NDVI is already above the threshold at the first observation (1 Jan) and falls below it ' +
        'after 30 Sept, a 272-day season.',
    )
    // The first composite has no value, so the first observation is the next one.
    const late = curveOf([null, ...values.slice(1)], 0.2, 17, 273)
    expect(summariseCurve(late)).toMatch(
      /^NDVI is already above the threshold at the first observation \(17 Jan\) /,
    )
  })

  it('says NDVI is still above the threshold when the season ends at the last observation', () => {
    const values = ALL_ABOVE.map((v, i) => (i < 4 ? 0.1 : v))
    expect(summariseCurve(curveOf(values, 0.2, 65, 353))).toBe(
      'NDVI rises above the threshold on 6 Mar and is still above it at the last observation ' +
        '(19 Dec), a 288-day season.',
    )
    const early = curveOf([...values.slice(0, -1), null], 0.2, 65, 337)
    expect(summariseCurve(early)).toMatch(/is still above it at the last observation \(3 Dec\)/)
  })

  it('says when the season runs from the first observation to the last', () => {
    // As the API answers for (51.4, 0.0) in 2026 at a 5% threshold.
    const values = ALL_ABOVE.map((v, i) => (i === 0 ? 0.182358 : i === 22 ? 0.183763 : v))
    expect(summariseCurve(curveOf(values, 0.181825, 1, 353))).toBe(
      'NDVI is already above the threshold at the first observation (1 Jan) and is still above ' +
        'it at the last observation (19 Dec), a 352-day season.',
    )
  })

  it('says when the season is a single composite', () => {
    const values = DOYS.map((doy) => (doy === 193 ? 0.7 : 0.2))
    expect(summariseCurve(curveOf(values, 0.45, 193, 193))).toBe(
      'NDVI is above the threshold only on 12 Jul, a 0-day season.',
    )
  })

  it('works out the length from the dates when the API leaves it out', () => {
    expect(summariseCurve({ ...CURVE, season_length: null })).toMatch(/, a 192-day season\.$/)
  })

  it('says when there are no observations, no threshold or no season dates', () => {
    expect(summariseCurve(curveOf(DOYS.map(() => null), null, null, null))).toBe(
      'There are no NDVI observations for this year.',
    )
    expect(summariseCurve(curveOf(DOYS.map(() => 0.3), null, null, null))).toBe(
      'NDVI is flat this year, so there is no seasonal threshold.',
    )
    expect(summariseCurve({ ...CURVE, sos_date: null, eos_date: null })).toBe(
      'No season was computed for this year.',
    )
  })
})

describe('describeStored', () => {
  it('describes whichever stored dates there are', () => {
    expect(describeStored({ sos_date: '2021-04-11', eos_date: '2021-10-20' })).toBe(
      'The stored season runs from 11 Apr to 20 Oct.',
    )
    expect(describeStored({ sos_date: '2021-04-11', eos_date: null })).toBe(
      'The stored start of season is 11 Apr.',
    )
    expect(describeStored({ eos_date: '2021-10-20' })).toBe('The stored end of season is 20 Oct.')
    expect(describeStored({ sos_date: null })).toBeNull()
    expect(describeStored(null)).toBeNull()
  })
})

describe('segmentHits', () => {
  const box: Box = { left: 10, right: 20, top: 10, bottom: 20 }

  it('finds segments that cross, enter or lie inside a box', () => {
    expect(segmentHits({ x: 0, y: 15 }, { x: 30, y: 15 }, box)).toBe(true)
    expect(segmentHits({ x: 0, y: 0 }, { x: 30, y: 30 }, box)).toBe(true)
    expect(segmentHits({ x: 15, y: 15 }, { x: 40, y: 40 }, box)).toBe(true)
    expect(segmentHits({ x: 12, y: 12 }, { x: 18, y: 18 }, box)).toBe(true)
    expect(segmentHits({ x: 15, y: 0 }, { x: 15, y: 5 }, box)).toBe(false)
    expect(segmentHits({ x: 0, y: 0 }, { x: 30, y: 5 }, box)).toBe(false)
    expect(segmentHits({ x: 0, y: 12 }, { x: 8, y: 30 }, box)).toBe(false)
  })
})

describe('estimateTextWidth', () => {
  it('errs a little wide of what browsers measure, and well inside 6px a character', () => {
    // Chromium draws "Threshold 0.67" 73.6px wide in San Francisco, about 75px in DejaVu Sans.
    expect(estimateTextWidth('Threshold 0.67')).toBeCloseTo(79, 6)
    expect(estimateTextWidth('0.67')).toBeCloseTo(22.7, 6)
    // At 12px it scales with the size.
    expect(estimateTextWidth('0.67', 12)).toBeCloseTo(27.24, 6)
  })
})

describe('placeThresholdLabel', () => {
  const plot: Box = { left: 34, right: 300, top: 18, bottom: 216 }
  const text = 'Threshold 0.45'
  const width = estimateTextWidth(text)
  const layout = {
    value: '0.45',
    lineY: 120,
    plot,
    markers: [],
    storedMarkers: [],
    dots: [],
    lines: [],
  }
  // With nothing in the way: x 38 to 117, y 105 to 118, just above the line at 120.
  const leftAbove = { text, x: 38, baseline: 115 }

  it('goes at the left, just above the threshold line, when nothing is in the way', () => {
    expect(placeThresholdLabel(layout)).toEqual(leftAbove)
  })

  it('moves right of a marker that crosses its place', () => {
    const { x, baseline } = placeThresholdLabel({ ...layout, markers: [80] })
    expect(baseline).toBe(115)
    expect(x).toBeGreaterThan(80)
    expect(x).toBeLessThan(90)
  })

  it('keeps 2px clear of a marker and of the line', () => {
    expect(placeThresholdLabel({ ...layout, markers: [38 + width + 1] }).x).toBeGreaterThan(
      38 + width + 1,
    )
    expect(placeThresholdLabel({ ...layout, markers: [38 + width + 3] })).toEqual(leftAbove)
    // A curve level 1px above the label's box, all the way across, sends it below the line.
    const line = [
      { x: 34, y: 104 },
      { x: 300, y: 104 },
    ]
    const below = { text, x: 38, baseline: 132 }
    expect(placeThresholdLabel({ ...layout, lines: [line] })).toEqual(below)
  })

  it('goes below the line where the curve runs just above it the whole way', () => {
    const line = [
      { x: 34, y: 108 },
      { x: 300, y: 108 },
    ]
    expect(placeThresholdLabel({ ...layout, dots: line, lines: [line] })).toEqual({
      text,
      x: 38,
      baseline: 132,
    })
  })

  it('keeps clear of a dot near its place', () => {
    const { x } = placeThresholdLabel({ ...layout, dots: [{ x: 60, y: 112 }] })
    expect(x).toBeGreaterThan(60)
  })

  it("keeps dots 8px from its box: an enlarged dot's 6px reach and 2px of air", () => {
    const withDotAt = (gap: number) =>
      placeThresholdLabel({ ...layout, dots: [{ x: 38 + width + gap, y: 112 }] })
    expect(withDotAt(7.5).x).toBeGreaterThan(38 + width + 7.5)
    expect(withDotAt(8.5)).toEqual(leftAbove)
    // Above and below the box too: it spans y 105 to 118.
    const above = placeThresholdLabel({ ...layout, dots: [{ x: 60, y: 105 - 7.5 }] })
    expect(above.x).toBeGreaterThan(60)
    expect(placeThresholdLabel({ ...layout, dots: [{ x: 60, y: 105 - 8.5 }] })).toEqual(leftAbove)
  })

  it('moves clear of a stored marker as it does of a computed one', () => {
    const { x, baseline } = placeThresholdLabel({ ...layout, storedMarkers: [80] })
    expect(baseline).toBe(115)
    expect(x - 2).toBeGreaterThan(80)
  })

  it('takes the only clear spot, at the right edge, only if the label fits inside the plot', () => {
    // Markers every 10px, then a last one: the label fits right of it only 4px in from the edge,
    // with x on its 2px steps (216, ending at 295).
    const markersTo = (last: number) => [
      ...Array.from({ length: 18 }, (_, i) => 34 + 10 * i),
      last,
    ]
    expect(placeThresholdLabel({ ...layout, markers: markersTo(213) })).toEqual({
      text,
      x: 216,
      baseline: 115,
    })
    // 2px further on, the label would end past 296: only the bare value fits there.
    expect(placeThresholdLabel({ ...layout, markers: markersTo(215) })).toEqual({
      text: '0.45',
      x: 218,
      baseline: 115,
    })
  })

  it('crosses as few stored markers as it must when every spot crosses one', () => {
    // No gap between them is as wide as the label, and the first spots cross two.
    const storedMarkers = [40, 100, 140, 200, 240, 290]
    const fewest = { text, x: 44, baseline: 115 }
    expect(placeThresholdLabel({ ...layout, storedMarkers })).toEqual(fewest)
  })

  it('shortens to the bare value before it covers a computed marker, a dot or the line', () => {
    // Computed markers 70px apart leave no room for the whole text, but some for the value.
    expect(placeThresholdLabel({ ...layout, markers: [34, 104, 174, 244] })).toEqual({
      text: '0.45',
      x: 38,
      baseline: 115,
    })
    // The same with dots 70px apart just above and just below the line.
    const dots = [60, 130, 200, 270].flatMap((x) => [
      { x, y: 112 },
      { x, y: 128 },
    ])
    expect(placeThresholdLabel({ ...layout, dots })).toEqual({ text: '0.45', x: 70, baseline: 115 })
  })

  it('goes above the plot, right-aligned, where not even the value has room', () => {
    const markers = Array.from({ length: 30 }, (_, i) => 34 + 10 * i)
    expect(placeThresholdLabel({ ...layout, markers })).toEqual({
      text,
      x: 300 - width,
      baseline: -1,
    })
    // Or no room at all.
    const narrow = { ...plot, right: plot.left + 20 }
    expect(placeThresholdLabel({ ...layout, plot: narrow })).toEqual({
      text,
      x: 0,
      baseline: -1,
    })
  })

  it('places the label by the widths it is given', () => {
    // Measured narrower than estimated, the whole text fits between computed markers 70px apart.
    const measure = (t: string) => t.length * 4
    expect(
      placeThresholdLabel({ ...layout, markers: [34, 104, 174, 244], measure }),
    ).toEqual({ text, x: 38, baseline: 115 })
  })

  it('stays inside the plot', () => {
    // The line near the top: no room above it, so the label goes below.
    expect(placeThresholdLabel({ ...layout, lineY: 25 })).toEqual({ text, x: 38, baseline: 37 })
  })
})
