import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  })
}

/**
 * Renders `ui` at `path` inside a memory router (starting at `route`) and a fresh QueryClient
 * with retries off. Extra routes, such as link targets, can be added.
 */
export function renderWithProviders(
  ui: ReactElement,
  {
    route = '/',
    path = '/',
    routes = [],
  }: { route?: string; path?: string; routes?: RouteObject[] } = {},
) {
  const queryClient = testQueryClient()
  const router = createMemoryRouter([{ path, element: ui }, ...routes], {
    initialEntries: [route],
  })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...result, router, queryClient }
}
