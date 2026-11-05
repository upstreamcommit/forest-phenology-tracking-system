import 'maplibre-gl/dist/maplibre-gl.css'

import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
} from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import {
  Component,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import type { BBox } from '../../api/types'
import { StatusMessage } from '../../components/StatusMessage'
import type { ResolvedTheme } from '../../lib/theme'
import { findCellAt, type CellCollection, type CellProperties } from './gridLayer'
import {
  bboxOutline,
  CELLS_SOURCE,
  cellLayers,
  COMPUTED_SOURCE,
  labelLayerAboveBasemap,
  labelPaint,
  LAYER_IDS,
  outlineLayers,
  selectedFilter,
} from './mapLayers'
import { basemapStyle, plainStyle } from './mapStyles'

// MapLibre 6 locates its worker through import.meta.url, which Vite's dependency bundling
// breaks, so point it at the file Vite serves.
setWorkerUrl(workerUrl)

/** Roughly Great Britain, for when no bounds are known yet. */
const FALLBACK_CENTER: [number, number] = [-2.5, 54.5]

export interface PhenologyMapProps {
  /** Cell polygons from buildCells. */
  cells: CellCollection
  /** fill-color paint expression from the colour scale. */
  fillColor: ExpressionSpecification
  /** Exact stored coordinates of the selected cell. */
  selected: { lat: number; lon: number } | null
  /** Area with NDVI stacks, outlined with a dashed line. */
  computedBBox: BBox | undefined
  /** Area the map first fits to (the stored bbox). Later changes do not move the map. */
  initialBBox: BBox | undefined
  theme: ResolvedTheme
  /** Called with the clicked cell's properties, exact coordinates included. */
  onSelect: (cell: CellProperties) => void
  /** Accessible name of the map. */
  label: string
  /** Text alternative: what the map currently shows. */
  description?: string
}

function failureMessage(error: unknown): string {
  return error instanceof Error && /webgl/i.test(error.message)
    ? 'Your browser could not start WebGL, which the map needs.'
    : 'The map failed to start.'
}

/** Shows a message instead of the map when MapLibre cannot start (no WebGL, for one). */
class MapErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null }

  static getDerivedStateFromError(error: unknown) {
    return { message: failureMessage(error) }
  }

  render() {
    if (this.state.message === null) return this.props.children
    return (
      <div className="flex h-full items-center justify-center bg-surface-sunken p-6">
        <StatusMessage tone="error" title="The map could not be shown">
          {this.state.message} You can still choose a point with the coordinate search.
        </StatusMessage>
      </div>
    )
  }
}

/**
 * The MapLibre map of grid cells. The map is created once; prop changes update its sources,
 * paint and filters in place, and a theme change swaps the basemap and re-adds the overlay.
 */
export function PhenologyMap(props: PhenologyMapProps) {
  return (
    <MapErrorBoundary>
      <MapView {...props} />
    </MapErrorBoundary>
  )
}

function MapView({
  cells,
  fillColor,
  selected,
  computedBBox,
  initialBBox,
  theme,
  onSelect,
  label,
  description,
}: PhenologyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const appliedTheme = useRef(theme)
  const styleLoaded = useRef(false)
  const [basemapMissing, setBasemapMissing] = useState(false)
  const descriptionId = useId()

  const selectedId = useMemo(
    () => (selected ? (findCellAt(cells, selected.lat, selected.lon)?.id ?? null) : null),
    [cells, selected],
  )

  const initialOptions = useEffectEvent(() => {
    appliedTheme.current = theme
    const view = initialBBox ? { bounds: initialBBox } : { center: FALLBACK_CENTER, zoom: 4.5 }
    return { style: basemapStyle(theme), ...view, locale: { 'Map.Title': label } }
  })

  // Runs on every style load, so it always draws the latest props.
  const addOverlay = useEffectEvent((map: MapLibreMap) => {
    styleLoaded.current = true
    const basemapLayers = map.getStyle().layers
    const labels = labelPaint(theme)
    if (labels) {
      for (const layer of basemapLayers) {
        if (layer.type !== 'symbol') continue
        map.setPaintProperty(layer.id, 'text-color', labels.textColor)
        map.setPaintProperty(layer.id, 'text-halo-color', labels.haloColor)
        map.setPaintProperty(layer.id, 'text-halo-width', labels.haloWidth)
      }
    }
    const labelsAbove = labelLayerAboveBasemap(basemapLayers)
    map.addSource(CELLS_SOURCE, { type: 'geojson', data: cells })
    map.addSource(COMPUTED_SOURCE, { type: 'geojson', data: bboxOutline(computedBBox) })
    for (const layer of cellLayers(fillColor, theme)) map.addLayer(layer, labelsAbove)
    for (const layer of outlineLayers(selectedId, theme)) map.addLayer(layer)
  })

  // Feature ids are indexes into cells.features; hand back our own copy of the properties,
  // not the one that went through the worker.
  const selectCell = useEffectEvent((id: unknown) => {
    const feature = typeof id === 'number' ? cells.features[id] : undefined
    if (feature && feature.id === id) onSelect(feature.properties)
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Throws without WebGL; MapErrorBoundary shows the fallback.
    const map = new MapLibreMap({
      container,
      ...initialOptions(),
      fitBoundsOptions: { padding: 24 },
      dragRotate: false,
      pitchWithRotate: false,
    })
    mapRef.current = map
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')

    let hoveredId: number | null = null
    let plain = false
    const clearHover = () => {
      if (hoveredId !== null && map.getSource(CELLS_SOURCE)) {
        map.setFeatureState({ source: CELLS_SOURCE, id: hoveredId }, { hover: false })
      }
      hoveredId = null
    }

    map.on('style.load', () => {
      hoveredId = null
      addOverlay(map)
    })
    map.on('error', (event) => {
      // An error before the style loads means the basemap could not be fetched: carry on
      // without it rather than showing no cells at all.
      if (!styleLoaded.current && !plain) {
        plain = true
        setBasemapMissing(true)
        map.setStyle(plainStyle(appliedTheme.current), { diff: false })
        return
      }
      console.error(event.error)
    })
    map.on('mousemove', LAYER_IDS.fill, (event) => {
      const id = event.features?.[0]?.id
      if (typeof id !== 'number' || id === hoveredId) return
      clearHover()
      hoveredId = id
      map.setFeatureState({ source: CELLS_SOURCE, id }, { hover: true })
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', LAYER_IDS.fill, () => {
      clearHover()
      map.getCanvas().style.cursor = ''
    })
    map.on('click', LAYER_IDS.fill, (event) => selectCell(event.features?.[0]?.id))

    return () => {
      mapRef.current = null
      styleLoaded.current = false
      map.remove()
    }
  }, [])

  useEffect(() => {
    mapRef.current?.getSource<GeoJSONSource>(CELLS_SOURCE)?.setData(cells)
  }, [cells])

  useEffect(() => {
    mapRef.current?.getSource<GeoJSONSource>(COMPUTED_SOURCE)?.setData(bboxOutline(computedBBox))
  }, [computedBBox])

  useEffect(() => {
    const map = mapRef.current
    if (map?.getLayer(LAYER_IDS.fill)) map.setPaintProperty(LAYER_IDS.fill, 'fill-color', fillColor)
  }, [fillColor])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.getLayer(LAYER_IDS.selected)) return
    map.setFilter(LAYER_IDS.selected, selectedFilter(selectedId))
    map.setFilter(LAYER_IDS.selectedHalo, selectedFilter(selectedId))
  }, [selectedId])

  // Bring a cell picked off-screen (by the coordinate search, say) into view. MapLibre skips
  // the animation when the user prefers reduced motion.
  const selectedLat = selected?.lat
  const selectedLon = selected?.lon
  useEffect(() => {
    const map = mapRef.current
    if (!map || selectedLat === undefined || selectedLon === undefined) return
    if (!map.getBounds().contains([selectedLon, selectedLat])) {
      map.easeTo({ center: [selectedLon, selectedLat] })
    }
  }, [selectedLat, selectedLon])

  useEffect(() => {
    const map = mapRef.current
    if (!map || appliedTheme.current === theme) return
    appliedTheme.current = theme
    styleLoaded.current = false
    // A full reload fires style.load, which re-adds the overlay in the new theme's colours.
    map.setStyle(basemapMissing ? plainStyle(theme) : basemapStyle(theme), { diff: false })
  }, [theme, basemapMissing])

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas()
    canvas?.setAttribute('aria-label', label)
    if (description) canvas?.setAttribute('aria-describedby', descriptionId)
    else canvas?.removeAttribute('aria-describedby')
  }, [label, description, descriptionId])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {description && (
        <p id={descriptionId} className="sr-only">
          {description}
        </p>
      )}
      {basemapMissing && (
        <p className="absolute bottom-8 left-2 rounded-md bg-surface px-2 py-1 text-xs text-ink-muted shadow-panel">
          The basemap could not be loaded, so only the grid is shown.
        </p>
      )}
    </div>
  )
}
