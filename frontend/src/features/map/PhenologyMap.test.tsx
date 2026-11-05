import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { gridFor } from '../../test/fixtures'
import { buildColourScale } from './colourScale'
import { buildCells } from './gridLayer'
import { CELLS_SOURCE, LAYER_IDS, OVERLAY_COLOURS, selectedFilter } from './mapLayers'
import { PhenologyMap, type PhenologyMapProps } from './PhenologyMap'

type Handler = (event?: unknown) => void

const { FakeMap } = vi.hoisted(() => {
  /** Just enough of maplibre-gl's Map to check how the component drives it. */
  class FakeMap {
    static instances: FakeMap[] = []
    static failWith: Error | null = null
    /** Whether getBounds() contains whatever it is asked about. */
    static inView = true

    options: Record<string, unknown>
    handlers = new Map<string, Handler>()
    sources = new Map<string, { data: unknown; setData: ReturnType<typeof vi.fn> }>()
    layers: { id: string; beforeId?: string }[] = []
    canvas = document.createElement('canvas')
    setStyle = vi.fn(() => {
      this.sources.clear()
      this.layers = []
    })
    setPaintProperty = vi.fn()
    setFilter = vi.fn()
    setFeatureState = vi.fn()
    easeTo = vi.fn()
    remove = vi.fn()
    touchZoomRotate = { disableRotation: vi.fn() }
    keyboard = { disableRotation: vi.fn() }

    constructor(options: Record<string, unknown>) {
      if (FakeMap.failWith) throw FakeMap.failWith
      this.options = options
      FakeMap.instances.push(this)
    }

    on(type: string, layerOrHandler: string | Handler, handler?: Handler) {
      const key = typeof layerOrHandler === 'string' ? `${type}:${layerOrHandler}` : type
      this.handlers.set(key, handler ?? (layerOrHandler as Handler))
    }
    addControl() {}
    addSource(id: string, spec: { data: unknown }) {
      this.sources.set(id, { data: spec.data, setData: vi.fn() })
    }
    getSource(id: string) {
      return this.sources.get(id)
    }
    addLayer(layer: { id: string }, beforeId?: string) {
      this.layers.push({ id: layer.id, beforeId })
    }
    getLayer(id: string) {
      return this.layers.find((layer) => layer.id === id)
    }
    getStyle() {
      return { layers: [{ id: 'water', type: 'fill' }, { id: 'place-labels', type: 'symbol' }] }
    }
    getCanvas() {
      return this.canvas
    }
    getBounds() {
      return { contains: () => FakeMap.inView }
    }
  }
  return { FakeMap }
})
type FakeMapInstance = InstanceType<typeof FakeMap>

vi.mock('maplibre-gl', () => ({
  Map: FakeMap,
  NavigationControl: class {},
  setWorkerUrl: vi.fn(),
}))

/** Fires a map event, by type or as "type:layer". */
function fire(map: FakeMapInstance, key: string, event?: unknown) {
  act(() => map.handlers.get(key)?.(event))
}

const cells2020 = buildCells(gridFor(2020), 0.1)
const cells2021 = buildCells(gridFor(2021), 0.1)
const sosFill = buildColourScale({ metric: 'sos', values: [100, 120], theme: 'light' }).fillColor

function props(overrides: Partial<PhenologyMapProps> = {}): PhenologyMapProps {
  return {
    cells: cells2020,
    fillColor: sosFill,
    selected: null,
    computedBBox: [-1.005, 50.995, 0.005, 52.005],
    initialBBox: [-7.5, 49.5, 2.0, 59.0],
    theme: 'light',
    onSelect: () => {},
    label: 'Map of start of season in 2020',
    description: '121 grid cells.',
    ...overrides,
  }
}

beforeEach(() => {
  FakeMap.instances = []
  FakeMap.failWith = null
  FakeMap.inView = true
})

describe('PhenologyMap', () => {
  it('shows a message instead of crashing when WebGL is missing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    FakeMap.failWith = new Error('WebGL2 is required to display this map.')
    render(<PhenologyMap {...props()} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('The map could not be shown')
    expect(alert).toHaveTextContent('Your browser could not start WebGL, which the map needs.')
  })

  it('fits the stored area and adds the overlay, cells under the labels, once the style loads', () => {
    render(<PhenologyMap {...props()} />)
    const map = FakeMap.instances[0]
    expect(map.options.bounds).toEqual([-7.5, 49.5, 2.0, 59.0])
    expect(map.canvas).toHaveAccessibleName('Map of start of season in 2020')
    expect(map.canvas).toHaveAttribute('aria-describedby')

    fire(map, 'style.load')

    expect(map.getSource(CELLS_SOURCE)?.data).toBe(cells2020)
    expect(map.layers.find((l) => l.id === LAYER_IDS.fill)?.beforeId).toBe('place-labels')
    expect(map.layers.find((l) => l.id === LAYER_IDS.selected)?.beforeId).toBeUndefined()
    // The dashed outline of the computed area is drawn over a halo, like the selection.
    const ids = map.layers.map((l) => l.id)
    expect(ids.indexOf(LAYER_IDS.computedHalo)).toBe(ids.indexOf(LAYER_IDS.computed) - 1)
  })

  it('updates data, paint and selection in place', () => {
    const { rerender } = render(<PhenologyMap {...props()} />)
    const map = FakeMap.instances[0]
    fire(map, 'style.load')

    const fillColor = buildColourScale({ metric: 'eos', values: [280], theme: 'light' }).fillColor
    const selected = { lat: 51, lon: -1 }
    rerender(<PhenologyMap {...props({ cells: cells2021, fillColor, selected })} />)

    expect(FakeMap.instances).toHaveLength(1)
    expect(map.getSource(CELLS_SOURCE)?.setData).toHaveBeenCalledWith(cells2021)
    expect(map.setPaintProperty).toHaveBeenCalledWith(LAYER_IDS.fill, 'fill-color', fillColor)
    expect(map.setFilter).toHaveBeenCalledWith(LAYER_IDS.selected, selectedFilter(0))
    expect(map.setFilter).toHaveBeenCalledWith(LAYER_IDS.selectedHalo, selectedFilter(0))

    rerender(<PhenologyMap {...props({ cells: cells2021, fillColor, selected: null })} />)
    expect(map.setFilter).toHaveBeenLastCalledWith(LAYER_IDS.selectedHalo, selectedFilter(null))
  })

  it('brings a selection off-screen into view and leaves one on screen alone', () => {
    const { rerender } = render(<PhenologyMap {...props()} />)
    const map = FakeMap.instances[0]
    fire(map, 'style.load')

    rerender(<PhenologyMap {...props({ selected: { lat: 51.5, lon: -0.5 } })} />)
    expect(map.easeTo).not.toHaveBeenCalled()

    FakeMap.inView = false
    rerender(<PhenologyMap {...props({ selected: { lat: 51.8, lon: -0.2 } })} />)
    expect(map.easeTo).toHaveBeenCalledTimes(1)
    expect(map.easeTo).toHaveBeenCalledWith({ center: [-0.2, 51.8] })
  })

  it('outlines the cell under the pointer and clears it when the pointer leaves', () => {
    render(<PhenologyMap {...props()} />)
    const map = FakeMap.instances[0]
    fire(map, 'style.load')

    fire(map, `mousemove:${LAYER_IDS.fill}`, { features: [{ id: 3 }] })
    expect(map.setFeatureState).toHaveBeenLastCalledWith(
      { source: CELLS_SOURCE, id: 3 },
      { hover: true },
    )
    expect(map.canvas.style.cursor).toBe('pointer')

    fire(map, `mousemove:${LAYER_IDS.fill}`, { features: [{ id: 4 }] })
    expect(map.setFeatureState).toHaveBeenCalledWith({ source: CELLS_SOURCE, id: 3 }, { hover: false })
    expect(map.setFeatureState).toHaveBeenLastCalledWith(
      { source: CELLS_SOURCE, id: 4 },
      { hover: true },
    )

    fire(map, `mouseleave:${LAYER_IDS.fill}`)
    expect(map.setFeatureState).toHaveBeenLastCalledWith(
      { source: CELLS_SOURCE, id: 4 },
      { hover: false },
    )
    expect(map.canvas.style.cursor).toBe('')
  })

  it('draws the basemap labels light on a dark halo in the dark theme only', () => {
    const { rerender } = render(<PhenologyMap {...props()} />)
    const map = FakeMap.instances[0]
    fire(map, 'style.load')
    expect(map.setPaintProperty).not.toHaveBeenCalled()

    rerender(<PhenologyMap {...props({ theme: 'dark' })} />)
    fire(map, 'style.load')

    const { line, halo } = OVERLAY_COLOURS.dark
    expect(map.setPaintProperty).toHaveBeenCalledWith('place-labels', 'text-color', line)
    expect(map.setPaintProperty).toHaveBeenCalledWith('place-labels', 'text-halo-color', halo)
    expect(map.setPaintProperty).toHaveBeenCalledWith('place-labels', 'text-halo-width', 1.5)
    // Only label layers: the basemap's water and the app's own layers keep their colours.
    const restyled = new Set(map.setPaintProperty.mock.calls.map((call) => call[0]))
    expect([...restyled]).toEqual(['place-labels'])
  })

  it('hands back the stored properties of the clicked cell', () => {
    const onSelect = vi.fn()
    render(<PhenologyMap {...props({ onSelect })} />)
    const map = FakeMap.instances[0]
    fire(map, 'style.load')

    // Properties that went through the worker are not trusted; the id picks our own copy.
    fire(map, `click:${LAYER_IDS.fill}`, { features: [{ id: 12, properties: { lat: 0 } }] })

    expect(onSelect).toHaveBeenCalledWith(cells2020.features[12].properties)
  })

  it('swaps the basemap on a theme change and redraws the overlay', () => {
    const { rerender } = render(<PhenologyMap {...props()} />)
    const map = FakeMap.instances[0]
    fire(map, 'style.load')

    rerender(<PhenologyMap {...props({ theme: 'dark' })} />)
    expect(map.setStyle).toHaveBeenCalledTimes(1)
    expect(map.setStyle.mock.calls[0]).toEqual([
      'https://tiles.openfreemap.org/styles/dark',
      { diff: false },
    ])
    expect(map.getSource(CELLS_SOURCE)).toBeUndefined()

    fire(map, 'style.load')
    expect(map.getSource(CELLS_SOURCE)?.data).toBe(cells2020)
  })

  it('falls back to a plain background when the basemap cannot load', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<PhenologyMap {...props()} />)
    const map = FakeMap.instances[0]

    fire(map, 'error', { error: new Error('AJAXError: Failed to fetch') })

    expect(map.setStyle).toHaveBeenCalledWith(
      expect.objectContaining({ version: 8, sources: {} }),
      { diff: false },
    )
    expect(screen.getByText(/basemap could not be loaded/)).toBeInTheDocument()
  })

  it('removes the map on unmount', () => {
    const { unmount } = render(<PhenologyMap {...props()} />)
    unmount()
    expect(FakeMap.instances[0].remove).toHaveBeenCalled()
  })
})
