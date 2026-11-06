import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { gridFor } from '../../test/fixtures'
import { renderWithProviders } from '../../test/render'
import { server } from '../../test/server'
import { MapExplorerPage } from './MapExplorerPage'
import type { PhenologyMapProps } from './PhenologyMap'

// jsdom has no WebGL: stand in for the map with one button per cell.
vi.mock('./PhenologyMap', () => ({
  PhenologyMap: ({ cells, onSelect }: PhenologyMapProps) => (
    <div role="group" aria-label="Map">
      {cells.features.map((feature) => (
        <button key={feature.id} type="button" onClick={() => onSelect(feature.properties)}>
          {`Cell ${feature.properties.lat}, ${feature.properties.lon}`}
        </button>
      ))}
    </div>
  ),
}))

function renderMap(route: string) {
  return renderWithProviders(<MapExplorerPage />, {
    route,
    routes: [{ path: '/point/:lat/:lon', element: <p>Point details page</p> }],
  })
}

describe('MapExplorerPage point details link', () => {
  it('links the selected point to its detail page for the selected year', async () => {
    const user = userEvent.setup()
    renderMap('/?year=2022&lat=51.5&lon=-0.5')

    const panel = await screen.findByRole('region', { name: /^Selected point/ })
    const link = within(panel).getByRole('link', { name: 'Open point details' })
    expect(link).toHaveAttribute('href', '/point/51.5/-0.5?year=2022')

    await user.click(link)
    expect(screen.getByText('Point details page')).toBeInTheDocument()
  })

  it('keeps stored coordinates exact in the link', async () => {
    const user = userEvent.setup()
    const grid = gridFor(2020)
    grid.features[0].geometry.coordinates = [-0.30000000000000004, 51.300000000000004]
    server.use(http.get('*/phenology/grid', () => HttpResponse.json(grid)))
    renderMap('/?year=2020')

    await user.click(
      await screen.findByRole('button', { name: 'Cell 51.300000000000004, -0.30000000000000004' }),
    )

    const panel = await screen.findByRole('region', { name: /^Selected point/ })
    expect(within(panel).getByRole('link', { name: 'Open point details' })).toHaveAttribute(
      'href',
      '/point/51.300000000000004/-0.30000000000000004?year=2020',
    )
  })
})
