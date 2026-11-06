import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { testQueryClient } from '../test/render'
import { routes } from './router'

// The map page's chunk, held back until the test lets it "download". A module loads once per
// file, so this file has just the one test.
const mapChunk = vi.hoisted(() => {
  let release: () => void = () => {}
  const loaded = new Promise<void>((resolve) => {
    release = resolve
  })
  return { loaded, release: () => release() }
})

vi.mock('../features/map/MapExplorerPage', async () => {
  await mapChunk.loaded
  return { MapExplorerPage: () => <h1>Phenology map</h1> }
})

describe('MapRoute', () => {
  it('renders the shell and a loading message while the map page loads', async () => {
    const warn = vi.spyOn(console, 'warn')
    render(
      <QueryClientProvider client={testQueryClient()}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />
      </QueryClientProvider>,
    )

    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading the map')
    expect(screen.queryByRole('heading', { name: 'Phenology map' })).not.toBeInTheDocument()
    // The shell asks for the API status without waiting for the map.
    expect(await screen.findByText('API online')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Phenology map' })).not.toBeInTheDocument()

    act(() => mapChunk.release())
    expect(await screen.findByRole('heading', { level: 1, name: 'Phenology map' })).toBeVisible()
    expect(screen.queryByText(/Loading the map/)).not.toBeInTheDocument()
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('HydrateFallback'))
  })
})
