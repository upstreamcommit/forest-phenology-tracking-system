import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

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
})
