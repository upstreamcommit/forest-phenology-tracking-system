import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
} from 'maplibre-gl'

import type { BBox } from '../../api/types'
import type { ResolvedTheme } from '../../lib/theme'

export const CELLS_SOURCE = 'fpts-cells'
export const COMPUTED_SOURCE = 'fpts-computed-area'

export const LAYER_IDS = {
  fill: 'fpts-cell-fill',
  hover: 'fpts-cell-hover',
  computedHalo: 'fpts-computed-outline-halo',
  computed: 'fpts-computed-outline',
  selectedHalo: 'fpts-cell-selected-halo',
  selected: 'fpts-cell-selected',
} as const

/**
 * Outline colours. `line` matches the ink token of each theme, so the legend's dashed swatch
 * (drawn with border-ink) matches the computed-area outline; `halo`, drawn under the computed-area
 * and selected outlines, keeps them visible over any fill colour.
 */
export const OVERLAY_COLOURS: Record<ResolvedTheme, { line: string; halo: string }> = {
  light: { line: '#1c2620', halo: '#ffffff' },
  dark: { line: '#e7ede8', halo: '#0b100d' },
}

export const CELL_FILL_OPACITY = 0.85

/** Matches the selected cell by feature id, or nothing. */
export function selectedFilter(id: number | null): FilterSpecification {
  return ['==', ['id'], id ?? -1]
}

/** The computed (NDVI stack) area as a polygon, or nothing. */
export function bboxOutline(bbox: BBox | undefined) {
  const features = bbox
    ? [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'Polygon' as const,
            coordinates: [
              [
                [bbox[0], bbox[1]],
                [bbox[2], bbox[1]],
                [bbox[2], bbox[3]],
                [bbox[0], bbox[3]],
                [bbox[0], bbox[1]],
              ],
            ],
          },
        },
      ]
    : []
  return { type: 'FeatureCollection' as const, features }
}

/** Layers drawn under the basemap's labels, so place names stay readable over the cells. */
export function cellLayers(fillColor: ExpressionSpecification, theme: ResolvedTheme) {
  const hovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false]
  const layers: LayerSpecification[] = [
    {
      id: LAYER_IDS.fill,
      type: 'fill',
      source: CELLS_SOURCE,
      paint: {
        'fill-color': fillColor,
        'fill-opacity': CELL_FILL_OPACITY,
        // Antialiased edges overlap between neighbours and show as a faint grid.
        'fill-antialias': false,
      },
    },
    {
      id: LAYER_IDS.hover,
      type: 'line',
      source: CELLS_SOURCE,
      paint: {
        'line-color': OVERLAY_COLOURS[theme].line,
        'line-width': 1.5,
        'line-opacity': ['case', hovered, 1, 0],
      },
    },
  ]
  return layers
}

/** Layers drawn on top of everything. */
export function outlineLayers(selectedId: number | null, theme: ResolvedTheme) {
  const { line, halo } = OVERLAY_COLOURS[theme]
  const layers: LayerSpecification[] = [
    {
      id: LAYER_IDS.computedHalo,
      type: 'line',
      source: COMPUTED_SOURCE,
      paint: { 'line-color': halo, 'line-width': 4 },
    },
    {
      id: LAYER_IDS.computed,
      type: 'line',
      source: COMPUTED_SOURCE,
      paint: { 'line-color': line, 'line-width': 1.5, 'line-dasharray': [3, 2] },
    },
    {
      id: LAYER_IDS.selectedHalo,
      type: 'line',
      source: CELLS_SOURCE,
      filter: selectedFilter(selectedId),
      paint: { 'line-color': halo, 'line-width': 5 },
    },
    {
      id: LAYER_IDS.selected,
      type: 'line',
      source: CELLS_SOURCE,
      filter: selectedFilter(selectedId),
      paint: { 'line-color': line, 'line-width': 2.5 },
    },
  ]
  return layers
}

/**
 * Paint for the basemap's labels in the dark theme, which draws them in dim colours that get lost
 * over the cells: light text on a dark halo. Null in the light theme, whose labels already read
 * well.
 */
export function labelPaint(theme: ResolvedTheme) {
  if (theme === 'light') return null
  const { line, halo } = OVERLAY_COLOURS.dark
  return { textColor: line, haloColor: halo, haloWidth: 1.5 }
}

/**
 * The id of the layer to insert the cells before: the first label layer after the basemap's last
 * fill or line layer. Basemap styles interleave a few labels among their road layers, so
 * inserting before the first label would leave roads drawn over the cells.
 */
export function labelLayerAboveBasemap(
  layers: readonly { id: string; type: string }[],
): string | undefined {
  let lastDrawn = -1
  layers.forEach((layer, index) => {
    if (layer.type !== 'symbol') lastDrawn = index
  })
  return layers[lastDrawn + 1]?.id
}
