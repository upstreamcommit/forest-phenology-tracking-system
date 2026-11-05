import type { Page, Route } from '@playwright/test'

import {
  catalog,
  gridFor,
  ndviCurveFor,
  pointFor,
  timeseriesFor,
} from '../src/test/fixtures'

export interface MockOptions {
  /** Make every API call fail as if the backend were down. */
  apiDown?: boolean
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

/** Answers the app's API calls from the shared test fixtures, like MSW does in unit tests. */
export async function mockApi(page: Page, options: MockOptions = {}) {
  await page.route(/\/(health|catalog|phenology\/[a-z/]+)(\?|$)/, (route) => {
    if (options.apiDown) return route.abort('connectionrefused')

    const url = new URL(route.request().url())
    const q = url.searchParams
    const num = (name: string) => Number(q.get(name))

    switch (url.pathname) {
      case '/health':
        return json(route, { status: 'ok', environment: 'e2e', phenology_repo_backend: 'mock' })
      case '/catalog':
        return json(route, catalog)
      case '/phenology/grid':
        return json(route, gridFor(num('year')))
      case '/phenology/point':
        return json(route, pointFor(num('lat'), num('lon'), num('year')))
      case '/phenology/timeseries':
        return json(route, timeseriesFor(num('lat'), num('lon'), num('start_year'), num('end_year')))
      case '/phenology/point/ndvi':
        return json(route, ndviCurveFor(num('lat'), num('lon'), num('year')))
      default:
        return json(route, { detail: 'Not Found' }, 404)
    }
  })
}
