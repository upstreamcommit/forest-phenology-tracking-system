import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

import { describeError } from '../lib/errors'

/** Shown when a route fails to load or render, instead of a blank page. */
export function RouteErrorPage() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : describeError(error)

  return (
    <div role="alert" className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-ink-muted">{message}</p>
      <div className="mt-6 flex gap-4">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="font-medium text-accent underline"
        >
          Reload the page
        </button>
        <Link to="/" className="font-medium text-accent underline">
          Back to the map
        </Link>
      </div>
    </div>
  )
}
