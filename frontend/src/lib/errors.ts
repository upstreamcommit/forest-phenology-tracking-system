import { ApiError } from '../api/client'

/** A sentence for the user about why a request failed. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case 'network':
        return 'The API could not be reached. Check that the backend is running.'
      case 'server':
        return 'The API had an internal problem. Try again in a moment.'
      case 'not_found':
      case 'out_of_coverage':
      case 'validation':
      case 'too_many_features':
      case 'http':
        return error.message
    }
  }
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}
