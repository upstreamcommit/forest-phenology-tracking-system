import { describe, expect, it } from 'vitest'

import type { SeasonAverage } from '../charts/seasons'
import { describeComparison } from './comparison'

const average: SeasonAverage = {
  sos: 100.4,
  eos: 280.2,
  length: 179.8,
  count: 11,
  firstYear: 2016,
  lastYear: 2026,
}

describe('describeComparison', () => {
  it('says how much longer and earlier a season was, in whole days', () => {
    expect(describeComparison({ year: 2020, sos: 96, eos: 282, length: 186 }, average)).toEqual([
      "Season 6 days longer than this point's 2016–2026 average",
      'Started 4 days earlier than average',
      'Ended 2 days later than average',
    ])
  })

  it('uses the singular for one day and handles shorter, later seasons', () => {
    expect(describeComparison({ year: 2021, sos: 101, eos: 279, length: 178 }, average)).toEqual([
      "Season 2 days shorter than this point's 2016–2026 average",
      'Started 1 day later than average',
      'Ended 1 day earlier than average',
    ])
  })

  it('keeps the three sentences consistent when the average has fractional days', () => {
    // Rounded on its own, the length difference (209 - 208.636) would be 0 days while the end
    // was a day later and the start on the average day.
    const fractional: SeasonAverage = { ...average, sos: 87.818, eos: 296.455, length: 208.636 }
    expect(describeComparison({ year: 2020, sos: 88, eos: 297, length: 209 }, fractional)).toEqual([
      "Season 1 day longer than this point's 2016–2026 average",
      'Started on the average day',
      'Ended 1 day later than average',
    ])
    expect(describeComparison({ year: 2021, sos: 89, eos: 296, length: 207 }, fractional)).toEqual([
      "Season 1 day shorter than this point's 2016–2026 average",
      'Started 1 day later than average',
      'Ended on the average day',
    ])
  })

  it('says when a season matches the average', () => {
    expect(describeComparison({ year: 2022, sos: 100, eos: 280, length: 180 }, average)).toEqual([
      "Season length matches this point's 2016–2026 average",
      'Started on the average day',
      'Ended on the average day',
    ])
  })
})
