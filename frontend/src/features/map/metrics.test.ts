import { describe, expect, it } from 'vitest'

import type { GridPointProperties } from '../../api/types'
import { DEFAULT_METRIC, isMetricKey, METRIC_KEYS, METRICS } from './metrics'

const point: GridPointProperties = {
  sos_date: '2021-04-11',
  eos_date: '2021-10-19',
  season_length: 191,
  is_forest: true,
}

describe('metric definitions', () => {
  it('lists the four metrics in picker order with their labels', () => {
    expect(METRIC_KEYS.map((key) => METRICS[key].label)).toEqual([
      'Season length',
      'Start of season',
      'End of season',
      'Forest',
    ])
    expect(DEFAULT_METRIC).toBe('season_length')
    for (const key of METRIC_KEYS) expect(METRICS[key].description).toMatch(/\.$/)
  })

  it('reads values from grid point properties, dates as day of year', () => {
    expect(METRICS.season_length.value(point)).toBe(191)
    expect(METRICS.sos.value(point)).toBe(101)
    expect(METRICS.eos.value(point)).toBe(292)
    expect(METRICS.forest.value(point)).toBe(1)
    expect(METRICS.forest.value({ ...point, is_forest: false })).toBe(0)
  })

  it('treats missing dates and lengths as no value', () => {
    const empty = { ...point, sos_date: null, eos_date: null, season_length: null }
    expect(METRICS.sos.value(empty)).toBeNull()
    expect(METRICS.eos.value(empty)).toBeNull()
    expect(METRICS.season_length.value(empty)).toBeNull()
  })

  it('formats values for people', () => {
    expect(METRICS.season_length.format(193)).toBe('193 days')
    expect(METRICS.season_length.format(1)).toBe('1 day')
    expect(METRICS.sos.format(101, 2021)).toBe('11 Apr')
    expect(METRICS.eos.format(292, 2021)).toBe('19 Oct')
    expect(METRICS.forest.format(1)).toBe('Forest')
    expect(METRICS.forest.format(0)).toBe('Open land')
    for (const key of METRIC_KEYS) expect(METRICS[key].format(null)).toBe('No data')
  })

  it('shows a day of year as a date in the given year, or a non-leap year', () => {
    expect(METRICS.sos.format(60, 2024)).toBe('29 Feb')
    expect(METRICS.sos.format(60)).toBe('1 Mar')
  })

  it('recognises metric keys', () => {
    expect(isMetricKey('sos')).toBe(true)
    expect(isMetricKey('forest')).toBe(true)
    expect(isMetricKey('ndvi')).toBe(false)
    expect(isMetricKey(null)).toBe(false)
  })
})
