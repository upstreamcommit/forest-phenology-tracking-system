import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'

import { cancelTestQueries } from './render'
import { server } from './server'

// Requests MSW is still answering, such as one behind a delay the test did not wait for. Each
// test waits for them, so a late answer cannot reach the next test's requests. MSW never reports
// the end of a request the client aborted, so an aborted one counts as settled once longer than
// any test handler's delay has passed.
const ABORT_GRACE_MS = 150
const inFlight = new Map<string, { url: string; settledAt: number | null }>()
server.events.on('request:start', (event) => {
  const entry = { url: event.request.url, settledAt: null as number | null }
  inFlight.set(event.requestId, entry)
  event.request.signal.addEventListener(
    'abort',
    () => {
      entry.settledAt = Date.now() + ABORT_GRACE_MS
    },
    { once: true },
  )
})
server.events.on('request:end', (event) => {
  inFlight.delete(event.requestId)
})

async function settleRequests(timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  const pending = () =>
    [...inFlight.values()].filter(
      (entry) => entry.settledAt === null || entry.settledAt > Date.now(),
    )
  while (pending().length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  const stuck = pending()
  if (stuck.length > 0) {
    const urls = stuck.map((entry) => entry.url).join(', ')
    console.warn(`Requests still in flight ${timeoutMs} ms after the test: ${urls}`)
  }
  inFlight.clear()
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  await cancelTestQueries()
  await settleRequests()
  server.resetHandlers()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})
afterAll(() => server.close())

// jsdom lacks these browser APIs.
function defaultMatchMedia(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }
}

Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn(defaultMatchMedia) })

// A test that changes what matchMedia answers must not leak that into the next test.
afterEach(() => {
  window.matchMedia = vi.fn(defaultMatchMedia)
})

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// jsdom has no layout, so no scrolling; tests that check scrolling stub this themselves.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
