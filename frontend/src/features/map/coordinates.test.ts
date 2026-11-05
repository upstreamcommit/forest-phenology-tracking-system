import { describe, expect, it } from 'vitest'

import { parseDegrees } from './coordinates'

describe('parseDegrees', () => {
  it('reads decimal degrees with either sign character', () => {
    expect(parseDegrees('51.5', 'lat')).toBe(51.5)
    expect(parseDegrees(' -0.5 ', 'lon')).toBe(-0.5)
    expect(parseDegrees('−0.47', 'lon')).toBe(-0.47)
    expect(parseDegrees('+2', 'lon')).toBe(2)
    expect(parseDegrees('.5', 'lat')).toBe(0.5)
  })

  it('accepts a comma as the decimal separator', () => {
    expect(parseDegrees('51,5', 'lat')).toBe(51.5)
    expect(parseDegrees('-0,47', 'lon')).toBe(-0.47)
  })

  it('reads a hemisphere letter, with or without a space or degree sign', () => {
    expect(parseDegrees('51.5N', 'lat')).toBe(51.5)
    expect(parseDegrees('51.5 s', 'lat')).toBe(-51.5)
    expect(parseDegrees('0.5 W', 'lon')).toBe(-0.5)
    expect(parseDegrees('0,5w', 'lon')).toBe(-0.5)
    expect(parseDegrees('1.2° E', 'lon')).toBe(1.2)
    expect(parseDegrees('51.5°N', 'lat')).toBe(51.5)
  })

  it('rejects letters for the other axis, letters with a sign, and anything else', () => {
    expect(parseDegrees('0.5 W', 'lat')).toBeNaN()
    expect(parseDegrees('51.5 N', 'lon')).toBeNaN()
    expect(parseDegrees('-0.5 W', 'lon')).toBeNaN()
    for (const text of ['', '  ', 'abc', '1.2.3', '51,5,0', '0x10', '1e3', 'N', '5 NW']) {
      expect(parseDegrees(text, 'lat')).toBeNaN()
    }
  })
})
