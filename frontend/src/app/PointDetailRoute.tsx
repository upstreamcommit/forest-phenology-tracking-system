import { lazy, Suspense } from 'react'

import { StatusMessage } from '../components/StatusMessage'

// Loads with the charts on demand; the route itself is eager, so the shell renders (and starts
// its API calls) while the page's chunk downloads, as for the map.
const PointDetailPage = lazy(async () => ({
  default: (await import('../features/point-detail/PointDetailPage')).PointDetailPage,
}))

export function PointDetailRoute() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-xl px-4 py-12">
          <StatusMessage tone="loading" title="Loading the point" />
        </div>
      }
    >
      <PointDetailPage />
    </Suspense>
  )
}
