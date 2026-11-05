import { describe, expect, it } from 'vitest'

import type { BBox, GridResponse } from '../../api/types'
import { catalog, gridFor } from '../../test/fixtures'
import {
  buildCells,
  findCellAt,
  findNearestCell,
  isInBBox,
  resolveGridStep,
  type CellCollection,
} from './gridLayer'

const stored = catalog.products[0].stored!

function gridOf(points: [number, number][]): GridResponse {
  return {
    type: 'FeatureCollection',
    product: 'ndvi_synth',
    year: 2021,
    requested_bbox: null,
    features: points.map(([lon, lat], i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        sos_date: i === 0 ? '2021-04-11' : null,
        eos_date: i === 0 ? '2021-10-19' : null,
        season_length: i === 0 ? 191 : null,
        is_forest: i === 0,
      },
    })),
  }
}

describe('buildCells', () => {
  it('draws a closed counter-clockwise square of one grid step around each point', () => {
    const cells = buildCells(gridOf([[-0.5, 51.5]]), 0.1)
    const ring = cells.features[0].geometry.coordinates[0]
    const expected = [
      [-0.55, 51.45],
      [-0.45, 51.45],
      [-0.45, 51.55],
      [-0.55, 51.55],
      [-0.55, 51.45],
    ]
    expect(ring).toHaveLength(5)
    ring.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(expected[i][0], 12)
      expect(y).toBeCloseTo(expected[i][1], 12)
    })
    let twiceArea = 0
    for (let i = 0; i < 4; i++) {
      twiceArea += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    }
    expect(twiceArea).toBeGreaterThan(0)
  })

  it('keeps the stored coordinates exactly, never rounded', () => {
    const lon = -0.30000000000000004
    const lat = 51.300000000000004
    const cells = buildCells(gridOf([[lon, lat]]), 0.1)
    expect(Object.is(cells.features[0].properties.lon, lon)).toBe(true)
    expect(Object.is(cells.features[0].properties.lat, lat)).toBe(true)
  })

  it('carries the metrics as numbers and the index as feature id', () => {
    const cells = buildCells(gridOf([[-0.5, 51.5], [-0.4, 51.5]]), 0.1)
    expect(cells.features.map((f) => f.id)).toEqual([0, 1])
    expect(cells.features[0].properties).toEqual({
      lat: 51.5,
      lon: -0.5,
      season_length: 191,
      sos: 101,
      eos: 292,
      forest: 1,
    })
    expect(cells.features[1].properties).toMatchObject({
      season_length: null,
      sos: null,
      eos: null,
      forest: 0,
    })
  })
})

describe('resolveGridStep', () => {
  it("uses the catalog's grid step", () => {
    expect(resolveGridStep({ ...stored, grid_step_deg: 0.25 })).toBe(0.25)
  })

  it('infers the step from the stored longitudes when the catalog has none', () => {
    const step = resolveGridStep({ ...stored, grid_step_deg: null }, gridFor(2020))
    expect(step).toBeCloseTo(0.1, 9)
  })

  it('falls back to 0.1 degree', () => {
    expect(resolveGridStep(null)).toBe(0.1)
    expect(resolveGridStep({ ...stored, grid_step_deg: null }, gridOf([[-0.5, 51.5]]))).toBe(0.1)
  })
})

describe('findNearestCell', () => {
  const cells: CellCollection = buildCells(gridFor(2020), 0.1)

  it('finds the cell drawn around the query point', () => {
    expect(findNearestCell(cells, 51.53, -0.47)?.properties).toMatchObject({ lat: 51.5, lon: -0.5 })
    expect(findNearestCell(cells, 51.5, -0.5)?.properties).toMatchObject({ lat: 51.5, lon: -0.5 })
  })

  it('accepts a point up to one step beyond the outermost points', () => {
    expect(findNearestCell(cells, 52.09, 0.0)?.properties).toMatchObject({ lat: 52, lon: 0 })
    expect(findNearestCell(cells, 50.95, -1.08)?.properties).toMatchObject({ lat: 51, lon: -1 })
  })

  it('returns null further away, and for invalid input', () => {
    expect(findNearestCell(cells, 52.2, 0)).toBeNull()
    expect(findNearestCell(cells, 51.5, 0.25)).toBeNull()
    expect(findNearestCell(cells, 40, -3)).toBeNull()
    expect(findNearestCell(cells, Number.NaN, 0)).toBeNull()
    expect(findNearestCell({ type: 'FeatureCollection', features: [] }, 51.5, -0.5)).toBeNull()
  })
})

describe('findCellAt', () => {
  it('matches stored coordinates exactly', () => {
    const lon = -0.30000000000000004
    const cells = buildCells(gridOf([[lon, 51.3]]), 0.1)
    expect(findCellAt(cells, 51.3, lon)?.id).toBe(0)
    expect(findCellAt(cells, 51.3, -0.3)).toBeNull()
  })
})

describe('isInBBox', () => {
  const bbox: BBox = [-1.005, 50.995, 0.005, 52.005]

  it('includes points inside and on the edges', () => {
    expect(isInBBox(51.5, -0.5, bbox)).toBe(true)
    expect(isInBBox(50.995, -1.005, bbox)).toBe(true)
    expect(isInBBox(52.005, 0.005, bbox)).toBe(true)
  })

  it('excludes points outside, and everything without a bbox', () => {
    expect(isInBBox(52.1, -0.5, bbox)).toBe(false)
    expect(isInBBox(51.5, 0.1, bbox)).toBe(false)
    expect(isInBBox(51.5, -0.5, undefined)).toBe(false)
    expect(isInBBox(51.5, -0.5, null)).toBe(false)
  })
})
