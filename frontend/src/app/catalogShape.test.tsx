import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { catalog } from '../test/fixtures'
import { testQueryClient } from '../test/render'
import { server } from '../test/server'
import { routes } from './router'

// The real pages, with the map itself left out: jsdom has no WebGL.
vi.mock('../features/map/PhenologyMap', () => ({
  PhenologyMap: ({ label }: { label: string }) => <div role="group" aria-label={label} />,
}))

function renderApp(route: string) {
  render(
    <QueryClientProvider client={testQueryClient()}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [route] })} />
    </QueryClientProvider>,
  )
}

const [product] = catalog.products

describe.each([
  ['no product list', { ...catalog, products: undefined }],
  ['a product list that is not a list', { ...catalog, products: { synthetic: true } }],
  ['a product that is null', { ...catalog, products: [null] }],
  ['a product without an id', { ...catalog, products: [{ ...product, id: undefined }] }],
  ['stored coverage without years', { ...catalog, products: [{ ...product, stored: {} }] }],
])('a catalogue with %s', (_, body) => {
  it("gets the map page's error state, with Try again, inside the shell", async () => {
    server.use(http.get('*/catalog', () => HttpResponse.json(body)))
    renderApp('/')

    const main = screen.getByRole('main')
    const alert = await within(main).findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the list of datasets')
    expect(alert).toHaveTextContent('Unexpected response from the API.')
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })

  it("gets the About page's error state inside the shell", async () => {
    server.use(http.get('*/catalog', () => HttpResponse.json(body)))
    renderApp('/about')

    const main = screen.getByRole('main')
    const alert = await within(main).findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the catalogue')
    expect(alert).toHaveTextContent('Unexpected response from the API.')
    expect(within(main).getByRole('heading', { level: 1, name: 'Data & methods' })).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })
})

it('loads the map once Try again gets a catalogue of the right shape', async () => {
  const user = userEvent.setup()
  // Malformed until Try again: the shell and the page may each fetch the catalogue first.
  let malformed = true
  server.use(
    http.get('*/catalog', () =>
      HttpResponse.json(malformed ? { ...catalog, products: [null] } : catalog),
    ),
  )
  renderApp('/')

  const tryAgain = await screen.findByRole('button', { name: 'Try again' })
  malformed = false
  await user.click(tryAgain)
  expect(await screen.findByRole('heading', { level: 1, name: 'Phenology map' })).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
