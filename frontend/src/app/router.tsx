import { createBrowserRouter, type RouteObject } from 'react-router'

import { AboutPage } from '../features/about/AboutPage'
import { AppShell } from './AppShell'
import { MapRoute } from './MapRoute'
import { NotFoundPage } from './NotFoundPage'
import { PointDetailRoute } from './PointDetailRoute'
import { RouteErrorPage } from './RouteErrorPage'

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        // A page that fails shows its error inside the shell, so the header and navigation stay.
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: <MapRoute /> },
          { path: 'point/:lat/:lon', element: <PointDetailRoute /> },
          { path: 'about', element: <AboutPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
