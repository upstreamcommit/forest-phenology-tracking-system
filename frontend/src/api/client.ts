/**
 * The one place the app talks HTTP. A request or body read that fails (other than a
 * cancellation, which passes through as it is), an error status, and a 2xx body that is empty,
 * not JSON, does not parse or fails the caller's shape check each become an ApiError with a `kind`
 * the UI can branch on. Error statuses are read from whichever of the API's error bodies came back:
 *   {detail: "..."}                               plain HTTPException
 *   {detail: [{type, loc, msg, input, ctx?}]}      validation (FastAPI's shape)
 *   {error: "out_of_coverage", message, ...}       point outside the raster stack
 *   text/plain "Internal Server Error"             unhandled server error
 * Without a shape check, callers get a parsed 2xx body as the type they asked for, unchecked.
 */

export type ApiErrorKind =
  | 'not_found'
  | 'validation'
  | 'too_many_features'
  | 'out_of_coverage'
  | 'server'
  | 'network'
  | 'http'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  /** HTTP status, or 0 when the request never got a response. */
  readonly status: number
  readonly body: unknown

  constructor(kind: ApiErrorKind, status: number, message: string, body: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.body = body
  }

  /** 4xx answers are final: retrying the same request gets the same answer. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500
  }
}

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? ''

type QueryValue = string | number | boolean | null | undefined

/** Builds a same-origin URL. Numbers use String(), which round-trips doubles exactly. */
export function apiUrl(path: string, query: Record<string, QueryValue> = {}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value))
  }
  const qs = params.toString()
  return `${BASE_URL}${path}${qs ? `?${qs}` : ''}`
}

interface ValidationItem {
  type?: string
  loc?: (string | number)[]
  msg?: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Turns any error response into an ApiError. Exported for tests. */
export function toApiError(status: number, body: unknown): ApiError {
  if (isRecord(body) && body.error === 'out_of_coverage') {
    const message =
      typeof body.message === 'string' ? body.message : 'Location is outside dataset coverage.'
    return new ApiError('out_of_coverage', status, message, body)
  }

  if (isRecord(body) && Array.isArray(body.detail)) {
    const items = body.detail as ValidationItem[]
    const kind = items.some((i) => i.type === 'too_many_features')
      ? 'too_many_features'
      : 'validation'
    const message = items
      .map((i) => {
        const field = i.loc?.filter((part) => part !== 'query' && part !== 'body').join('.')
        return field ? `${field}: ${i.msg ?? 'invalid'}` : (i.msg ?? 'Invalid request')
      })
      .join('; ')
    return new ApiError(kind, status, message || 'Invalid request', body)
  }

  if (isRecord(body) && typeof body.detail === 'string') {
    const kind = status === 404 ? 'not_found' : status === 400 ? 'validation' : 'http'
    return new ApiError(kind, status, body.detail, body)
  }

  if (status >= 500) {
    return new ApiError('server', status, `The server had a problem (${status}).`, body)
  }
  return new ApiError('http', status, `Request failed (${status}).`, body)
}

/** A cancelled request: callers (TanStack Query) expect it back as it is, not as an ApiError. */
function isAbort(error: unknown, signal: AbortSignal | null | undefined): boolean {
  return signal?.aborted === true || (isRecord(error) && error.name === 'AbortError')
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  isShape?: (body: unknown) => body is T,
): Promise<T> {
  let response: Response
  let text: string
  try {
    response = await fetch(url, { ...init, headers: { Accept: 'application/json', ...init.headers } })
    // Reading the body can fail too, if the connection drops partway.
    text = await response.text()
  } catch (error) {
    if (isAbort(error, init.signal)) throw error
    throw new ApiError('network', 0, 'Could not reach the API. Is it running?', error)
  }

  let body: unknown = text
  let parsed = false
  if (text && (response.headers.get('content-type') ?? '').includes('json')) {
    try {
      body = JSON.parse(text)
      parsed = true
    } catch {
      body = text
    }
  }

  if (!response.ok) throw toApiError(response.status, body)
  // A success that isn't JSON (a proxy's HTML page, say), or isn't shaped like what the caller
  // asked for, is not the data the caller asked for.
  if (!parsed || (isShape && !isShape(body))) {
    throw new ApiError('http', response.status, 'Unexpected response from the API.', body)
  }
  return body as T
}
