import { http, HttpResponse } from 'msw'

import {
  catalog,
  gridFor,
  ndviCurveFor,
  pointFor,
  timeseriesFor,
} from './fixtures'

function num(url: URL, name: string): number {
  return Number(url.searchParams.get(name))
}

/** Happy-path API handlers. Tests override them with server.use(...) for error cases. */
export const handlers = [
  http.get('*/health', () =>
    HttpResponse.json({
      status: 'ok',
      environment: 'test',
      phenology_repo_backend: 'memory',
      cache_backend: 'memory',
    }),
  ),
  http.get('*/catalog', () => HttpResponse.json(catalog)),
  http.get('*/phenology/grid', ({ request }) => {
    const url = new URL(request.url)
    return HttpResponse.json(gridFor(num(url, 'year')))
  }),
  http.get('*/phenology/point/ndvi', ({ request }) => {
    const url = new URL(request.url)
    const frac = url.searchParams.has('threshold_frac') ? num(url, 'threshold_frac') : 0.5
    return HttpResponse.json(ndviCurveFor(num(url, 'lat'), num(url, 'lon'), num(url, 'year'), frac))
  }),
  http.get('*/phenology/point', ({ request }) => {
    const url = new URL(request.url)
    return HttpResponse.json(pointFor(num(url, 'lat'), num(url, 'lon'), num(url, 'year')))
  }),
  http.get('*/phenology/timeseries', ({ request }) => {
    const url = new URL(request.url)
    return HttpResponse.json(
      timeseriesFor(num(url, 'lat'), num(url, 'lon'), num(url, 'start_year'), num(url, 'end_year')),
    )
  }),
]
