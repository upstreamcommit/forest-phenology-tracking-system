import { afterEach, describe, expect, it, vi } from 'vitest'

import { BASEMAP_URLS, basemapStyle, PLAIN_BACKGROUND, plainStyle } from './mapStyles'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('basemapStyle', () => {
  it('uses the OpenFreeMap style for each theme', () => {
    expect(basemapStyle('light', undefined)).toBe('https://tiles.openfreemap.org/styles/positron')
    expect(basemapStyle('dark', undefined)).toBe('https://tiles.openfreemap.org/styles/dark')
    expect(BASEMAP_URLS.light).not.toBe(BASEMAP_URLS.dark)
  })

  it('draws only a background, fetching nothing, when VITE_BASEMAP is none', () => {
    vi.stubEnv('VITE_BASEMAP', 'none')
    const light = basemapStyle('light')
    const dark = basemapStyle('dark')

    expect(light).toEqual({
      version: 8,
      sources: {},
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: { 'background-color': PLAIN_BACKGROUND.light },
        },
      ],
    })
    expect(dark).toEqual(plainStyle('dark'))
    expect(JSON.stringify(dark)).toContain(PLAIN_BACKGROUND.dark)
    expect(JSON.stringify([light, dark])).not.toMatch(/https?:/)
  })
})
