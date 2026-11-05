import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { testQueryClient } from '../test/render'
import { routes } from './router'

// The map page is mocked, but MapRoute still loads it lazily, so the first render of '/' in this
// file shows 'Loading the map' for a moment: tests wait for the page with findBy. MapRoute.test.tsx
// covers the shell while it is still loading.
const mapPage = vi.hoisted(() => ({ fails: false }))

vi.mock('../features/map/MapExplorerPage', () => ({
  MapExplorerPage: () => {
    if (mapPage.fails) throw new Error('The map page broke.')
    return <h1>Phenology map</h1>
  },
}))

afterEach(() => {
  mapPage.fails = false
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

describe('router', () => {
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

  it('shows a page that fails inside the shell, keeping the header and navigation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mapPage.fails = true
    const user = userEvent.setup()
    renderApp('/')

    const main = screen.getByRole('main')
    expect(await within(main).findByRole('alert')).toHaveTextContent('The map page broke.')
    expect(
      within(main).getByRole('heading', { level: 1, name: 'Something went wrong' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(document.title).toBe('Something went wrong · Forest Phenology Explorer')

    // The other pages still work.
    await user.click(screen.getByRole('link', { name: 'Data & methods' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Data & methods' })).toHaveFocus()
    expect(screen.queryByText('The map page broke.')).not.toBeInTheDocument()
  })
})
