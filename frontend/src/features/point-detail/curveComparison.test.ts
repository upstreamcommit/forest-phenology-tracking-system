import { describe, expect, it } from 'vitest'

import { ndviCurveFor } from '../../test/fixtures'
import { compositeSpacing, daysBetween, describeDateShift } from './curveComparison'

describe('daysBetween', () => {
  it('counts whole days, negative when the second date is earlier', () => {
    expect(daysBetween('2022-04-03', '2022-05-09')).toBe(36)
    expect(daysBetween('2022-04-11', '2022-04-07')).toBe(-4)
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2)
    expect(daysBetween('2022-04-11', 'soon')).toBeNull()
  })
})

describe('describeDateShift', () => {
  it('says how the computed date relates to the stored one', () => {
    expect(describeDateShift('start', '2022-04-07', '2022-04-11')).toBe(
      'Computed start 7 Apr, 4 days before the stored start',
    )
    expect(describeDateShift('end', '2022-10-16', '2022-10-15')).toBe(
      'Computed end 16 Oct, 1 day after the stored end',
    )
    expect(describeDateShift('start', '2022-04-07', '2022-04-07')).toBe(
      'Computed start 7 Apr, the same day as the stored start',
    )
    expect(describeDateShift('start', '2022-04-07', '')).toBeNull()
  })
})

describe('compositeSpacing', () => {
  it('reads the gap between composites, 16 days by default', () => {
    expect(compositeSpacing(ndviCurveFor(51.5, -0.5, 2022).observations)).toBe(16)
    expect(
      compositeSpacing([
        { doy: 9, date: '2022-01-09', ndvi: 0.2 },
        { doy: 1, date: '2022-01-01', ndvi: 0.2 },
      ]),
    ).toBe(8)
    expect(compositeSpacing([])).toBe(16)
  })
})
