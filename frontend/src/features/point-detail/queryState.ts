import { ApiError } from '../../api/client'

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'not_found'
}

/** The API's answer that the point has no data there, as opposed to a failed request. */
export function isNoDataAnswer(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.kind === 'not_found' || error.kind === 'out_of_coverage')
  )
}
