import { describe, expect, it } from 'vitest'

import type { Product, StoredCoverage } from '../../api/types'
import { catalog } from '../../test/fixtures'
import { mapPath, pointDetailPath } from './paths'
import {
  describeArea,
  findStoredProduct,
  formatThreshold,
  gridPointNearCentre,
  parseLocation,
  parseThreshold,
} from './pointParams'

const product = catalog.products[0]

describe('parseLocation', () => {
  it('reads numbers on the globe exactly', () => {
    expect(parseLocation('51.5', '-0.5')).toEqual({ lat: 51.5, lon: -0.5 })
    expect(parseLocation('51.300000000000004', '-0.30000000000000004')).toEqual({
      lat: 51.300000000000004,
      lon: -0.30000000000000004,
    })
    expect(parseLocation('-90', '180')).toEqual({ lat: -90, lon: 180 })
  })

  it.each([
    ['abc', '0'],
    ['51.5', ''],
    [undefined, '0'],
    ['91', '0'],
    ['0', '-180.5'],
    ['Infinity', '0'],
  ])('rejects lat %j, lon %j', (lat, lon) => {
    expect(parseLocation(lat, lon)).toBeNull()
  })
})

describe('parseThreshold', () => {
  it('snaps to the slider\'s 5% steps', () => {
    expect(parseThreshold('0.6', 0.5)).toBe(0.6)
    expect(parseThreshold('0.6000000000000001', 0.5)).toBe(0.6)
    expect(parseThreshold('0.33', 0.5)).toBe(0.35)
    expect(parseThreshold('0.333', 0.5)).toBe(0.35)
    expect(parseThreshold('0.31', 0.5)).toBe(0.3)
  })

  it('keeps a fraction within the slider\'s 5–95% range', () => {
    expect(parseThreshold('0.02', 0.5)).toBe(0.05)
    expect(parseThreshold('0.001', 0.5)).toBe(0.05)
    expect(parseThreshold('0.97', 0.5)).toBe(0.95)
    expect(parseThreshold('0.999', 0.5)).toBe(0.95)
  })

  it.each([null, '', 'x', '0', '1', '-0.2', '1.5', 'Infinity'])(
    'falls back for %j',
    (raw) => {
      expect(parseThreshold(raw, 0.5)).toBe(0.5)
    },
  )

  it('formats as a percentage', () => {
    expect(formatThreshold(0.5)).toBe('50%')
    expect(formatThreshold(0.05)).toBe('5%')
  })
})

describe('findStoredProduct', () => {
  it('picks the first product with stored years', () => {
    const computedOnly: Product = { ...product, id: 'raw', stored: null }
    const emptyStored: Product = {
      ...product,
      id: 'empty',
      stored: { years: [], bbox: [0, 0, 1, 1], grid_step_deg: 0.1 },
    }
    expect(findStoredProduct([computedOnly, emptyStored, product])?.id).toBe(product.id)
    expect(findStoredProduct([computedOnly])).toBeUndefined()
  })
})

describe('describeArea', () => {
  it('names the area with the catalog values', () => {
    expect(describeArea([-1.005, 50.995, 0.005, 52.005])).toBe(
      'latitude 50.995° N to 52.005° N, longitude 1.005° W to 0.005° E',
    )
    expect(describeArea([10, -5, 20, 5])).toBe(
      'latitude 5° S to 5° N, longitude 10° E to 20° E',
    )
  })
})

describe('gridPointNearCentre', () => {
  it('snaps the centre of the computed area to the stored grid', () => {
    expect(gridPointNearCentre(product.computed!.bbox, product.stored!)).toEqual({
      lat: 51.5,
      lon: -0.5,
    })
  })

  it('follows the grid origin and step', () => {
    const stored: StoredCoverage = {
      years: [2020],
      bbox: [0.125, 10.125, 5, 20],
      grid_step_deg: 0.25,
    }
    expect(gridPointNearCentre([1, 11, 2, 12], stored)).toEqual({
      lat: 11.625,
      lon: 1.625,
    })
  })
})

describe('paths', () => {
  it('builds detail and map links with exact coordinates', () => {
    expect(pointDetailPath(51.5, -0.5, 2022)).toBe('/point/51.5/-0.5?year=2022')
    expect(pointDetailPath(51.300000000000004, -0.30000000000000004)).toBe(
      '/point/51.300000000000004/-0.30000000000000004',
    )
    expect(mapPath(51.5, -0.5, 2022)).toBe('/?year=2022&lat=51.5&lon=-0.5')
  })
})
