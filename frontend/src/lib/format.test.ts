import { describe, expect, it } from 'vitest'

import {
  formatCoordinates,
  formatDays,
  formatDayShift,
  formatPreciseCoordinates,
} from './format'

describe('formatCoordinates', () => {
  it('rounds to two decimals by default, with the hemisphere', () => {
    expect(formatCoordinates(51.5, -0.5)).toBe('51.50° N, 0.50° W')
    expect(formatCoordinates(-33.86, 151.2, 3)).toBe('33.860° S, 151.200° E')
  })
})

describe('formatPreciseCoordinates', () => {
  it('keeps two decimals for points on the 0.01° grid', () => {
    expect(formatPreciseCoordinates(51.5, -0.5)).toBe('51.50° N, 0.50° W')
    expect(formatPreciseCoordinates(51.49, -0.49)).toBe('51.49° N, 0.49° W')
    expect(formatPreciseCoordinates(51.300000000000004, -0.30000000000000004)).toBe(
      '51.30° N, 0.30° W',
    )
  })

  it('shows the decimals that tell nearby points apart, up to five', () => {
    expect(formatPreciseCoordinates(51.495, -0.495)).toBe('51.495° N, 0.495° W')
    expect(formatPreciseCoordinates(51.4951, -0.5)).toBe('51.4951° N, 0.5000° W')
    expect(formatPreciseCoordinates(51.123456789, 0)).toBe('51.12346° N, 0.00000° E')
  })

  it('gives both the decimals the more precise of the two needs, whichever it is', () => {
    // The longitude alone needs a third decimal; to two it would read as 0.49° W or 0.50° W.
    expect(formatPreciseCoordinates(51.5, -0.495)).toBe('51.500° N, 0.495° W')
    expect(formatPreciseCoordinates(-33.865, 151.2)).toBe('33.865° S, 151.200° E')
    expect(formatPreciseCoordinates(-33.86, 151.2093)).toBe('33.8600° S, 151.2093° E')
  })
})

describe('formatDays', () => {
  it('counts days, with a dash for no value', () => {
    expect(formatDays(193)).toBe('193 days')
    expect(formatDays(1)).toBe('1 day')
    expect(formatDays(null)).toBe('–')
  })
})

describe('formatDayShift', () => {
  it('signs the difference', () => {
    expect(formatDayShift(4)).toBe('+4 days')
    expect(formatDayShift(-1)).toBe('−1 day')
    expect(formatDayShift(0)).toBe('same day')
  })
})
