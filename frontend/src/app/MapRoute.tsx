import { lazy, Suspense } from 'react'

import { StatusMessage } from '../components/StatusMessage'

// MapLibre is most of the bundle, so the map page loads on demand. The route itself is eager,
// so the shell renders (and starts its API calls) while the page's chunk downloads.
const MapExplorerPage = lazy(async () => ({
  default: (await import('../features/map/MapExplorerPage')).MapExplorerPage,
}))

export function MapRoute() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-xl px-4 py-12">
          <StatusMessage tone="loading" title="Loading the map" />
        </div>
      }
    >
      <MapExplorerPage />
    </Suspense>
  )
}
