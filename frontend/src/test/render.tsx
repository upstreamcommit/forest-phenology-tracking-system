import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'

const liveClients = new Set<QueryClient>()

export function testQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  })
  liveClients.add(client)
  return client
}

/**
 * Cancels every request the test's query clients still have in flight, so a response the test
 * did not wait for cannot land in the next test. Runs after each test (see setup.ts).
 */
export async function cancelTestQueries(): Promise<void> {
  const clients = [...liveClients]
  liveClients.clear()
  await Promise.all(clients.map((client) => client.cancelQueries()))
  for (const client of clients) client.clear()
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
