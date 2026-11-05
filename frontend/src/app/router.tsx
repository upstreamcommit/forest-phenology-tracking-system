import { createBrowserRouter, type RouteObject } from 'react-router'

import { AboutPage } from '../features/about/AboutPage'
import { AppShell } from './AppShell'
import { NotFoundPage } from './NotFoundPage'
import { RouteErrorPage } from './RouteErrorPage'

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        index: true,
        // MapLibre is most of the bundle, so the map page loads on demand.
        lazy: async () => ({
          Component: (await import('../features/map/MapExplorerPage')).MapExplorerPage,
        }),
      },
      { path: 'about', element: <AboutPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
