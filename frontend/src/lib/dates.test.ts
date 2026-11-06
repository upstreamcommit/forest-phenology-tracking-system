import { describe, expect, it } from 'vitest'

import {
  dateFromDayOfYear,
  dayOfYear,
  formatDate,
  formatDayMonth,
  parseIsoDate,
  REFERENCE_YEAR,
} from './dates'

describe('the test time zone', () => {
  it('is west of Greenwich, so local-time date handling would fail these tests', () => {
    expect(new Date('2021-04-11').getDate()).toBe(10)
  })
})

describe('parseIsoDate', () => {
  it('parses a calendar date as UTC midnight', () => {
    expect(parseIsoDate('2021-04-11')?.toISOString()).toBe('2021-04-11T00:00:00.000Z')
  })

  it('rejects dates that do not exist and other formats', () => {
    for (const iso of [
      '2021-02-29',
      '2100-02-29',
      '2021-04-31',
      '2021-13-01',
      '2021-00-10',
      '2021-04-00',
      '2021-4-11',
      '2021-04-11T00:00:00Z',
      '11/04/2021',
      '',
    ]) {
      expect(parseIsoDate(iso), iso).toBeNull()
    }
  })

  it('accepts 29 February in leap years', () => {
    expect(parseIsoDate('2024-02-29')?.toISOString()).toBe('2024-02-29T00:00:00.000Z')
    expect(parseIsoDate('2000-02-29')).not.toBeNull()
  })
})

describe('dayOfYear', () => {
  it('counts from 1 January', () => {
    expect(dayOfYear('2021-01-01')).toBe(1)
    expect(dayOfYear('2021-04-11')).toBe(101)
  })

  it('counts the leap day', () => {
    expect(dayOfYear('2023-03-01')).toBe(60)
    expect(dayOfYear('2024-02-29')).toBe(60)
    expect(dayOfYear('2024-03-01')).toBe(61)
    expect(dayOfYear('2023-12-31')).toBe(365)
    expect(dayOfYear('2024-12-31')).toBe(366)
  })

  it('throws for something that is not a calendar date', () => {
    expect(() => dayOfYear('2023-02-29')).toThrow('Not a calendar date: 2023-02-29')
  })
})

describe('dateFromDayOfYear', () => {
  it('is the inverse of dayOfYear, including the year ends', () => {
    expect(dateFromDayOfYear(2021, 1)).toBe('2021-01-01')
    expect(dateFromDayOfYear(2021, 365)).toBe('2021-12-31')
    expect(dateFromDayOfYear(2024, 60)).toBe('2024-02-29')
    expect(dateFromDayOfYear(2023, 60)).toBe('2023-03-01')
    expect(dateFromDayOfYear(2024, 366)).toBe('2024-12-31')
    for (const iso of ['2016-01-01', '2020-02-29', '2022-07-15', '2024-12-31']) {
      expect(dateFromDayOfYear(Number(iso.slice(0, 4)), dayOfYear(iso))).toBe(iso)
    }
  })
})

describe('REFERENCE_YEAR', () => {
  it('is not a leap year', () => {
    expect(dayOfYear(`${REFERENCE_YEAR}-12-31`)).toBe(365)
  })
})

describe('formatDate and formatDayMonth', () => {
  it('show the calendar date itself, not the day before', () => {
    expect(formatDate('2021-01-01')).toBe('1 Jan 2021')
    expect(formatDate('2021-12-31')).toBe('31 Dec 2021')
    expect(formatDate('2024-02-29')).toBe('29 Feb 2024')
    expect(formatDayMonth('2021-01-01')).toBe('1 Jan')
    expect(formatDayMonth('2021-04-11')).toBe('11 Apr')
  })

  it('return anything that is not a calendar date unchanged', () => {
    expect(formatDate('2021-02-30')).toBe('2021-02-30')
    expect(formatDayMonth('soon')).toBe('soon')
  })
})
