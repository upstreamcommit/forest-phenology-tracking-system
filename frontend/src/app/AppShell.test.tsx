import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { catalog } from '../test/fixtures'
import { renderWithProviders, testQueryClient } from '../test/render'
import { server } from '../test/server'
import { AboutPage } from '../features/about/AboutPage'
import { AppShell } from './AppShell'
import { NotFoundPage } from './NotFoundPage'
import { RouteErrorPage } from './RouteErrorPage'

function renderShell(route = '/about') {
  return renderWithProviders(<AppShell />, {
    route,
    path: '/',
    routes: [],
  })
}

describe('AppShell', () => {
  it('has a skip link, main navigation and a main landmark', async () => {
    renderShell('/')

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Map' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Data & methods' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main')
  })

  it('shows the API status from /health', async () => {
    renderShell('/')
    expect(await screen.findByText('API online')).toBeInTheDocument()
  })

  it('says when the API cannot be reached', async () => {
    server.use(http.get('*/health', () => HttpResponse.error()))
    renderShell('/')
    expect(await screen.findByText('API unreachable')).toBeInTheDocument()
  })

  it('warns on every page when the data is synthetic', async () => {
    renderShell('/')
    expect(await screen.findByText(/synthetic/)).toBeInTheDocument()
  })

  it('shows no synthetic warning when no product is synthetic', async () => {
    server.use(
      http.get('*/catalog', () =>
        HttpResponse.json({
          ...catalog,
          products: catalog.products.map((p) => ({ ...p, synthetic: false })),
        }),
      ),
    )
    renderShell('/')
    await screen.findByText('API online')
    expect(screen.queryByText(/synthetic/)).not.toBeInTheDocument()
  })

  it('marks the current page in the navigation with an underline, not only colour', () => {
    renderShell('/')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const current = within(nav).getByRole('link', { name: 'Map' })
    const other = within(nav).getByRole('link', { name: 'Data & methods' })
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).toHaveClass('underline')
    expect(other).not.toHaveAttribute('aria-current')
    expect(other).not.toHaveClass('underline')
  })

  it('starts with a saved dark theme', () => {
    localStorage.setItem('fpts-theme', 'dark')
    renderShell('/')
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'false')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('switches and remembers the theme', async () => {
    const user = userEvent.setup()
    renderShell('/')

    await user.click(screen.getByRole('radio', { name: 'Dark' }))

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('fpts-theme')).toBe('dark')
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true')
    expect(localStorage.getItem('fpts-theme')).toBe('system')
  })
})

describe('AboutPage', () => {
  it('summarises the catalogue and links to the API docs', async () => {
    renderWithProviders(<AboutPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Data & methods' })).toBeInTheDocument()
    expect(await screen.findByText(/2016–2026, lon -7.5 to 2, lat 49.5 to 59, every 0.1°/)).toBeInTheDocument()
    expect(screen.getByText(/0.01° pixels/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '/docs' })).toHaveAttribute('href', '/docs')
  })

  it('reports a catalogue error', async () => {
    server.use(http.get('*/catalog', () => HttpResponse.json({ detail: 'down' }, { status: 503 })))
    renderWithProviders(<AboutPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the catalogue')
  })
})

describe('NotFoundPage', () => {
  it('links back to the map', () => {
    renderWithProviders(<NotFoundPage />, { route: '/nowhere', path: '*' })
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the map' })).toHaveAttribute('href', '/')
  })
})

describe('RouteErrorPage', () => {
  it('says what went wrong, in the page title too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const router = createMemoryRouter([
      {
        path: '/',
        loader: () => {
          throw new Error('The map could not be loaded.')
        },
        element: null,
        errorElement: <RouteErrorPage />,
      },
    ])
    render(
      <QueryClientProvider client={testQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('The map could not be loaded.')
    expect(document.title).toBe('Something went wrong · Forest Phenology Explorer')
  })
})
