import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { describeError } from '../lib/errors'
import { server } from '../test/server'
import { ApiError, apiUrl, fetchJson, toApiError } from './client'

describe('apiUrl', () => {
  it('keeps doubles exact and drops missing values', () => {
    expect(apiUrl('/phenology/point', { lat: 51.123456789012, lon: -0.30000000000000004, mode: undefined })).toBe(
      '/phenology/point?lat=51.123456789012&lon=-0.30000000000000004',
    )
  })
})

describe('toApiError', () => {
  it('reads a plain detail string by status', () => {
    const error = toApiError(404, { detail: 'No phenology data found' })
    expect(error).toMatchObject({ kind: 'not_found', status: 404, message: 'No phenology data found' })
  })

  it('reads FastAPI validation errors and names the field', () => {
    const error = toApiError(422, {
      detail: [{ type: 'value_error', loc: ['query', 'bbox'], msg: 'Invalid bbox', input: 'x' }],
    })
    expect(error).toMatchObject({ kind: 'validation', message: 'bbox: Invalid bbox' })
  })

  it('tells too_many_features apart from other validation errors', () => {
    const error = toApiError(422, {
      detail: [{ type: 'too_many_features', loc: ['query', 'bbox'], msg: 'too many', ctx: { limit: 3 } }],
    })
    expect(error.kind).toBe('too_many_features')
  })

  it('reads the out_of_coverage body', () => {
    const error = toApiError(422, { error: 'out_of_coverage', message: 'Requested location is outside dataset coverage.' })
    expect(error).toMatchObject({ kind: 'out_of_coverage', message: 'Requested location is outside dataset coverage.' })
  })

  it("reads the API's 400 detail as a validation error", () => {
    const error = toApiError(400, { detail: 'Invalid parameters: end_year must be >= start_year' })
    expect(error).toMatchObject({
      kind: 'validation',
      status: 400,
      message: 'Invalid parameters: end_year must be >= start_year',
    })
  })

  it('treats a plain-text 500 as a server error', () => {
    expect(toApiError(500, 'Internal Server Error').kind).toBe('server')
  })
})

describe('fetchJson', () => {
  it('returns parsed JSON', async () => {
    await expect(fetchJson('/catalog')).resolves.toMatchObject({ default_threshold_frac: 0.5 })
  })

  it('throws an ApiError for an error response', async () => {
    server.use(http.get('*/catalog', () => HttpResponse.json({ detail: 'gone' }, { status: 404 })))
    await expect(fetchJson('/catalog')).rejects.toMatchObject({ kind: 'not_found', status: 404 })
  })

  it('reports a network failure as kind network with status 0', async () => {
    server.use(http.get('*/catalog', () => HttpResponse.error()))
    const error = await fetchJson('/catalog').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ kind: 'network', status: 0 })
  })

  it('reports a connection that drops while the body is read as a network failure', async () => {
    // fetch resolves with the headers; only reading the body fails.
    const response = new Response('{"products": [', {
      headers: { 'Content-Type': 'application/json' },
    })
    vi.spyOn(response, 'text').mockRejectedValue(new TypeError('terminated'))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)

    const error = await fetchJson('/catalog').catch((e: unknown) => e)
    expect(response.text).toHaveBeenCalled()
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ kind: 'network', status: 0 })
    expect(describeError(error)).toBe(
      'The API could not be reached. Check that the backend is running.',
    )
  })

  it('rejects a successful response that is not JSON', async () => {
    server.use(http.get('*/catalog', () => HttpResponse.html('<!doctype html><p>Proxy page</p>')))
    const error = await fetchJson('/catalog').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      kind: 'http',
      status: 200,
      message: 'Unexpected response from the API.',
    })
  })

  it('rejects a successful JSON response that does not parse, or is empty', async () => {
    const json = { headers: { 'Content-Type': 'application/json' } }
    server.use(http.get('*/catalog', () => new HttpResponse('{"products": [', json)))
    await expect(fetchJson('/catalog')).rejects.toMatchObject({ kind: 'http', status: 200 })

    server.use(http.get('*/catalog', () => new HttpResponse(null, { status: 200 })))
    await expect(fetchJson('/catalog')).rejects.toMatchObject({ kind: 'http', status: 200 })
  })

  it("rejects a successful JSON response that fails the caller's shape check", async () => {
    const hasItems = (body: unknown): body is { items: unknown[] } =>
      Array.isArray((body as { items?: unknown } | null)?.items)
    server.use(http.get('*/catalog', () => HttpResponse.json({ items: 'none' }, { status: 203 })))
    const error = await fetchJson('/catalog', {}, hasItems).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      kind: 'http',
      status: 203,
      message: 'Unexpected response from the API.',
      body: { items: 'none' },
    })

    server.use(http.get('*/catalog', () => HttpResponse.json({ items: [] })))
    await expect(fetchJson('/catalog', {}, hasItems)).resolves.toEqual({ items: [] })
  })

  it('passes a cancellation through as an AbortError, not an ApiError', async () => {
    const error = await fetchJson('/catalog', { signal: AbortSignal.abort() }).catch(
      (e: unknown) => e,
    )
    expect(error).not.toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ name: 'AbortError' })
  })
})
