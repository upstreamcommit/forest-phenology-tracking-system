import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-ink-muted">There is nothing at this address.</p>
      <Link to="/" className="mt-6 inline-block font-medium text-accent underline">
        Back to the map
      </Link>
    </div>
  )
}
