import { describe, expect, it } from 'vitest'

import type { BBox } from '../../api/types'
import {
  bboxOutline,
  cellLayers,
  labelLayerAboveBasemap,
  labelPaint,
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

    const outlines = outlineLayers(3, 'light')
    expect(outlines.map((layer) => layer.id)).toEqual([
      LAYER_IDS.computedHalo,
      LAYER_IDS.computed,
      LAYER_IDS.selectedHalo,
      LAYER_IDS.selected,
    ])
    expect(OVERLAY_COLOURS.light.line).not.toBe(OVERLAY_COLOURS.dark.line)
  })

  it('draws the dashed computed-area outline over a wider halo, so it shows on any fill', () => {
    for (const theme of ['light', 'dark'] as const) {
      const [halo, dashed] = outlineLayers(null, theme)
      if (halo.type !== 'line' || dashed.type !== 'line') throw new Error('expected lines')
      expect(halo.source).toBe(dashed.source)
      expect(halo.paint?.['line-color']).toBe(OVERLAY_COLOURS[theme].halo)
      expect(dashed.paint?.['line-color']).toBe(OVERLAY_COLOURS[theme].line)
      expect(dashed.paint?.['line-dasharray']).toEqual([3, 2])
      expect(halo.paint?.['line-dasharray']).toBeUndefined()
      expect(Number(halo.paint?.['line-width'])).toBeGreaterThan(Number(dashed.paint?.['line-width']))
    }
  })

  it('recolours basemap labels in the dark theme only', () => {
    expect(labelPaint('light')).toBeNull()
    expect(labelPaint('dark')).toEqual({
      textColor: OVERLAY_COLOURS.dark.line,
      haloColor: OVERLAY_COLOURS.dark.halo,
      haloWidth: 1.5,
    })
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
