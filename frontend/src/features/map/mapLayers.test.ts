import { describe, expect, it } from 'vitest'

import type { BBox } from '../../api/types'
import {
  bboxOutline,
  cellLayers,
  labelLayerAboveBasemap,
  LAYER_IDS,
  outlineLayers,
  OVERLAY_COLOURS,
  selectedFilter,
} from './mapLayers'

describe('map overlay layers', () => {
  it('matches the selected cell by feature id, or nothing', () => {
    expect(selectedFilter(7)).toEqual(['==', ['id'], 7])
    expect(selectedFilter(null)).toEqual(['==', ['id'], -1])
  })

  it('outlines the computed area as a closed ring, or not at all', () => {
    const bbox: BBox = [-1.005, 50.995, 0.005, 52.005]
    const ring = bboxOutline(bbox).features[0].geometry.coordinates[0]
    expect(ring).toHaveLength(5)
    expect(ring[0]).toEqual([-1.005, 50.995])
    expect(ring[2]).toEqual([0.005, 52.005])
    expect(ring[4]).toEqual(ring[0])
    expect(bboxOutline(undefined).features).toEqual([])
  })

  it('uses the given fill expression and theme colours', () => {
    const [fill, hover] = cellLayers(['to-color', '#123456'], 'dark')
    expect(fill.id).toBe(LAYER_IDS.fill)
    expect(fill.type === 'fill' && fill.paint?.['fill-color']).toEqual(['to-color', '#123456'])
    expect(hover.type === 'line' && hover.paint?.['line-color']).toBe(OVERLAY_COLOURS.dark.line)

    const ids = outlineLayers(3, 'light').map((layer) => layer.id)
    expect(ids).toEqual([LAYER_IDS.computed, LAYER_IDS.selectedHalo, LAYER_IDS.selected])
    expect(OVERLAY_COLOURS.light.line).not.toBe(OVERLAY_COLOURS.dark.line)
  })
})

describe('labelLayerAboveBasemap', () => {
  it('skips labels interleaved with roads and returns the first label above them', () => {
    const layers = [
      { id: 'water', type: 'fill' },
      { id: 'water-name', type: 'symbol' },
      { id: 'motorway', type: 'line' },
      { id: 'place-label', type: 'symbol' },
      { id: 'country-label', type: 'symbol' },
    ]
    expect(labelLayerAboveBasemap(layers)).toBe('place-label')
  })

  it('draws on top when the style has no labels after its last line', () => {
    expect(labelLayerAboveBasemap([{ id: 'bg', type: 'background' }])).toBeUndefined()
  })
})
