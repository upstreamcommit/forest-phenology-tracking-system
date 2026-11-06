import type { StyleSpecification } from 'maplibre-gl'

import type { ResolvedTheme } from '../../lib/theme'

/** OpenFreeMap vector basemaps. Their styles carry the attribution MapLibre displays. */
export const BASEMAP_URLS: Record<ResolvedTheme, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}

/** Background of the basemap-less style: the page's sunken surface in each theme. */
export const PLAIN_BACKGROUND: Record<ResolvedTheme, string> = {
  light: '#eef1ec',
  dark: '#0b100d',
}

/** A style with nothing but a background, fetched from nowhere. */
export function plainStyle(theme: ResolvedTheme): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': PLAIN_BACKGROUND[theme] },
      },
    ],
  }
}

/**
 * The basemap for a theme. VITE_BASEMAP=none (used by tests) swaps in the plain style so
 * nothing is fetched from the network.
 */
export function basemapStyle(
  theme: ResolvedTheme,
  basemap: string | undefined = import.meta.env.VITE_BASEMAP,
): string | StyleSpecification {
  return basemap === 'none' ? plainStyle(theme) : BASEMAP_URLS[theme]
}
