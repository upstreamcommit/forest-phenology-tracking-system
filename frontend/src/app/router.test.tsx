import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { testQueryClient } from '../test/render'
import { routes } from './router'

// The map page's chunk, held back until a test lets it "download".
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

function renderApp(route: string) {
  const router = createMemoryRouter(routes, { initialEntries: [route] })
  render(
    <QueryClientProvider client={testQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

// The map chunk loads once per file, so the loading test must run first.
describe('router', () => {
  it('renders the shell and a loading message while the map page loads', async () => {
    const warn = vi.spyOn(console, 'warn')
    renderApp('/')

    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading the map')
    expect(screen.queryByRole('heading', { name: 'Phenology map' })).not.toBeInTheDocument()
    // The shell asks for the API status without waiting for the map.
    expect(await screen.findByText('API online')).toBeInTheDocument()

    act(() => mapChunk.release())
    expect(await screen.findByRole('heading', { level: 1, name: 'Phenology map' })).toBeVisible()
    expect(screen.queryByText(/Loading the map/)).not.toBeInTheDocument()
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('HydrateFallback'))
  })

  it('titles each page', async () => {
    const router = renderApp('/about')
    expect(document.title).toBe('Data & methods · Forest Phenology Explorer')

    await act(() => router.navigate('/no/such/page'))
    expect(document.title).toBe('Page not found · Forest Phenology Explorer')
  })

  it('moves focus to the new page on client navigation, but not on first load', async () => {
    const user = userEvent.setup()
    const router = renderApp('/about')
    expect(screen.getByRole('heading', { level: 1, name: 'Data & methods' })).not.toHaveFocus()
    expect(document.body).toHaveFocus()

    await user.click(screen.getByRole('link', { name: 'Map' }))
    await screen.findByRole('heading', { level: 1, name: 'Phenology map' })
    // A page without a focusable heading gets main instead.
    expect(screen.getByRole('main')).toHaveFocus()

    await user.click(screen.getByRole('link', { name: 'Data & methods' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Data & methods' })).toHaveFocus()

    await act(() => router.navigate('/no/such/page'))
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toHaveFocus()

    // Query changes on the same page leave focus alone.
    const mapLink = screen.getByRole('link', { name: 'Map' })
    act(() => mapLink.focus())
    await act(() => router.navigate('/no/such/page?x=1'))
    expect(mapLink).toHaveFocus()
  })
})
