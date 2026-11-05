import { describe, expect, it } from 'vitest'

import { parseCoordinate, parseMetric, parseYear } from './urlState'

const YEARS = [2016, 2017, 2020, 2026]

describe('parseYear', () => {
  it('accepts a stored year', () => {
    expect(parseYear('2020', YEARS)).toBe(2020)
  })

  it('falls back to the latest stored year', () => {
    for (const raw of [null, '', 'abc', '1999', '2021', '2020.5']) {
      expect(parseYear(raw, YEARS)).toBe(2026)
    }
  })

  it('has no year when nothing is stored', () => {
    expect(parseYear('2020', [])).toBeUndefined()
  })
})

describe('parseMetric', () => {
  it('accepts a metric key and falls back to season length', () => {
    expect(parseMetric('eos')).toBe('eos')
    expect(parseMetric('bogus')).toBe('season_length')
    expect(parseMetric(null)).toBe('season_length')
  })
})

describe('parseCoordinate', () => {
  it('round-trips String(number) exactly', () => {
    const lon = -0.30000000000000004
    expect(parseCoordinate(String(lon))).toBe(lon)
    expect(parseCoordinate('51.5')).toBe(51.5)
  })

  it('rejects missing and non-numeric values', () => {
    for (const raw of [null, '', '  ', 'abc', 'Infinity', 'NaN']) {
      expect(parseCoordinate(raw)).toBeNull()
    }
  })
})
