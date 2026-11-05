import { describe, expect, it } from 'vitest'

import { timeseriesFor } from '../../test/fixtures'
import { averageSeason, seasonDays, yearRange } from './seasons'

describe('seasonDays', () => {
  it('turns the dates into days of year', () => {
    expect(
      seasonDays({ year: 2024, sos_date: '2024-04-01', eos_date: '2024-10-19', season_length: 201 }),
    ).toEqual({ year: 2024, sos: 92, eos: 293, length: 201 })
  })

  it('falls back to the gap between the dates when the length is missing', () => {
    expect(seasonDays({ year: 2023, sos_date: '2023-04-02', eos_date: '2023-10-20' })?.length).toBe(
      201,
    )
  })

  it('is null when either date is missing', () => {
    expect(seasonDays({ year: 2023, sos_date: null, eos_date: '2023-10-20' })).toBeNull()
    expect(seasonDays({ year: 2023, sos_date: '2023-04-02' })).toBeNull()
  })
})

describe('averageSeason', () => {
  it('averages every year of the fixture point', () => {
    const { metrics } = timeseriesFor(51.5, -0.5, 2016, 2026)
    const average = averageSeason(metrics)!
    expect(average.count).toBe(11)
    expect(average.firstYear).toBe(2016)
    expect(average.lastYear).toBe(2026)
    expect(average.sos).toBeCloseTo(1033 / 11, 10)
    expect(average.eos).toBeCloseTo(3207 / 11, 10)
    expect(average.length).toBeCloseTo(2174 / 11, 10)
  })

  it('skips years without dates and is null when none has them', () => {
    const average = averageSeason([
      { year: 2016, sos_date: '2016-04-01', eos_date: '2016-10-01', season_length: 183 },
      { year: 2017, sos_date: null, eos_date: null, season_length: null },
      { year: 2018, sos_date: '2018-04-11', eos_date: '2018-10-11', season_length: 183 },
    ])
    expect(average).toMatchObject({ count: 2, firstYear: 2016, lastYear: 2018, length: 183 })
    expect(averageSeason([{ year: 2017, sos_date: null, eos_date: null }])).toBeNull()
    expect(averageSeason([])).toBeNull()
  })
})

describe('yearRange', () => {
  it('joins two years with an en dash and leaves one year alone', () => {
    expect(yearRange(2016, 2026)).toBe('2016–2026')
    expect(yearRange(2020, 2020)).toBe('2020')
  })
})
