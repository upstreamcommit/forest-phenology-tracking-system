from datetime import date
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

# [min_lon, min_lat, max_lon, max_lat], the GeoJSON bbox order.
BBox = tuple[float, float, float, float]


class LocationSchema(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)

    model_config = ConfigDict(frozen=True)


class PhenologyYearMetricSchema(BaseModel):
    year: int
    sos_date: Optional[date] = None
    eos_date: Optional[date] = None
    season_length: Optional[int] = None
    is_forest: bool

    model_config = ConfigDict(frozen=True)


class SeasonLengthStat(str, Enum):
    mean = "mean"
    median = "median"
    both = "both"


class GeoJSONPolygonRequest(BaseModel):
    geometry: dict = Field(..., description="GeoJSON Polygon or MultiPolygon geometry")

    @field_validator("geometry")
    @classmethod
    def validate_geometry_type(cls, val: dict) -> dict:
        if not isinstance(val, dict):
            raise ValueError("Geometry must be a JSON object")

        geom_type = val.get("type")
        if geom_type not in {"Polygon", "MultiPolygon"}:
            raise ValueError("Only Polygon or MultiPolygon geometries are supported")

        if "coordinates" not in val:
            raise ValueError("GeoJSON geometry must contain coordinates")

        return val

    model_config = ConfigDict(frozen=True)


class PhenologyPointsRequest(BaseModel):
    locations: list[LocationSchema] = Field(..., min_length=1)

    model_config = ConfigDict(frozen=True)


class PhenologyAreaStatsResponse(BaseModel):
    product: str
    year: int
    n: int

    mean_season_length: float | None = None
    median_season_length: float | None = None
    forest_fraction: float | None = None

    model_config = ConfigDict(frozen=True)


class PhenologyPointResponse(BaseModel):
    """
    Phenology metrics for a single location and year.
    This is the shape that our phenology endpoints will return to a client.
    """

    year: int
    location: LocationSchema
    sos_date: Optional[date] = None
    eos_date: Optional[date] = None
    season_length: Optional[int] = None
    is_forest: bool

    model_config = ConfigDict(frozen=True)


class PhenologyTimeseriesResponse(BaseModel):
    product: str
    location: LocationSchema
    start_year: int
    end_year: int
    metrics: list[PhenologyYearMetricSchema]

    model_config = ConfigDict(frozen=True)


# For the response models below: list fields the server always sends (including null ones and
# GeoJSON "type" constants) as required in OpenAPI, so generated client types match responses.
_RESPONSE_CONFIG = ConfigDict(frozen=True, json_schema_serialization_defaults_required=True)


class StoredCoverageSchema(BaseModel):
    years: list[int]
    bbox: BBox = Field(..., description="[min_lon, min_lat, max_lon, max_lat] of stored points.")
    grid_step_deg: Optional[float] = Field(
        None,
        description=(
            "Spacing between stored longitudes. Repository lookups need a stored coordinate "
            "exactly, so take coordinates from /phenology/grid rather than rounding."
        ),
    )

    model_config = _RESPONSE_CONFIG


class ComputedCoverageSchema(BaseModel):
    years: list[int]
    bbox: BBox = Field(..., description="[min_lon, min_lat, max_lon, max_lat] outer pixel edges.")
    pixel_size_deg: float

    model_config = _RESPONSE_CONFIG


class ProductSchema(BaseModel):
    id: str
    label: str
    description: str
    synthetic: Optional[bool] = Field(
        ..., description="True for generated data; null when the product's origin is unknown."
    )
    stored: Optional[StoredCoverageSchema] = Field(
        None, description="Precomputed metrics (mode=repo, /timeseries, /area, /grid)."
    )
    computed: Optional[ComputedCoverageSchema] = Field(
        None, description="NDVI stacks to compute from (mode=compute, /points, /point/ndvi)."
    )

    model_config = _RESPONSE_CONFIG


class CatalogResponse(BaseModel):
    products: list[ProductSchema]
    default_threshold_frac: float

    model_config = _RESPONSE_CONFIG


class GridPointGeometry(BaseModel):
    type: Literal["Point"] = "Point"
    coordinates: tuple[float, float] = Field(..., description="[lon, lat] exactly as stored.")

    model_config = _RESPONSE_CONFIG


class GridPointProperties(BaseModel):
    sos_date: Optional[date] = None
    eos_date: Optional[date] = None
    season_length: Optional[int] = None
    is_forest: bool

    model_config = _RESPONSE_CONFIG


class GridFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: GridPointGeometry
    properties: GridPointProperties

    model_config = _RESPONSE_CONFIG


class PhenologyGridResponse(BaseModel):
    """
    A GeoJSON FeatureCollection of stored grid points. product, year and requested_bbox are
    foreign members (RFC 7946 section 6.1).
    """

    type: Literal["FeatureCollection"] = "FeatureCollection"
    product: str
    year: int
    requested_bbox: Optional[BBox] = None
    features: list[GridFeature]

    model_config = _RESPONSE_CONFIG


class NdviObservationSchema(BaseModel):
    doy: int
    date: date
    ndvi: Optional[float] = Field(..., description="null when the composite has no value.")

    model_config = _RESPONSE_CONFIG


class PhenologyNdviCurveResponse(BaseModel):
    """
    The NDVI series at the pixel nearest the requested point, and the season derived from it
    with the same threshold method as mode=compute.
    """

    product: str
    year: int
    location: LocationSchema = Field(..., description="The requested point.")
    pixel: LocationSchema = Field(..., description="Centre of the sampled pixel.")
    observations: list[NdviObservationSchema]
    threshold_frac: float
    threshold_ndvi: Optional[float] = Field(
        None, description="ndvi_min + threshold_frac * (ndvi_max - ndvi_min); null if flat."
    )
    sos_date: Optional[date] = None
    eos_date: Optional[date] = None
    season_length: Optional[int] = None

    model_config = _RESPONSE_CONFIG
