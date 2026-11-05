import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { gridFor } from '../../test/fixtures'
import { buildColourScale } from './colourScale'
import { buildCells } from './gridLayer'
import { CELLS_SOURCE, LAYER_IDS, selectedFilter } from './mapLayers'
import { PhenologyMap, type PhenologyMapProps } from './PhenologyMap'

type Handler = (event?: unknown) => void

const { FakeMap } = vi.hoisted(() => {
  /** Just enough of maplibre-gl's Map to check how the component drives it. */
  class FakeMap {
    static instances: FakeMap[] = []
    static failWith: Error | null = null

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
      return { contains: () => true }
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

function props(overrides: Partial<PhenologyMapProps> = {}): PhenologyMapProps {
  return {
    cells: cells2020,
    fillColor: buildColourScale({ metric: 'sos', values: [100, 120], theme: 'light' }).fillColor,
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
