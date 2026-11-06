import type { components } from './schema.gen'

type Schemas = components['schemas']

export type Catalog = Schemas['CatalogResponse']
export type Product = Schemas['ProductSchema']
export type StoredCoverage = Schemas['StoredCoverageSchema']
export type ComputedCoverage = Schemas['ComputedCoverageSchema']
export type GridResponse = Schemas['PhenologyGridResponse']
export type GridFeature = Schemas['GridFeature']
export type GridPointProperties = Schemas['GridPointProperties']
export type PointMetric = Schemas['PhenologyPointResponse']
export type Timeseries = Schemas['PhenologyTimeseriesResponse']
export type YearMetric = Schemas['PhenologyYearMetricSchema']
export type NdviCurve = Schemas['PhenologyNdviCurveResponse']
export type NdviObservation = Schemas['NdviObservationSchema']

/** [min_lon, min_lat, max_lon, max_lat], the GeoJSON bbox order. */
export type BBox = [number, number, number, number]

export type PointMode = 'repo' | 'compute' | 'auto'

export interface Health {
  status: string
  environment: string
  phenology_repo_backend: string
  cache_backend: string
}
