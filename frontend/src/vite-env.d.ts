/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Prefix for API requests; empty (same origin, via the dev proxy or nginx) by default. */
  readonly VITE_API_BASE_URL?: string
  /** "none" draws no basemap, for tests that must not touch the network. */
  readonly VITE_BASEMAP?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
