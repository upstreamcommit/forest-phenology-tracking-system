import math
from dataclasses import dataclass
from datetime import date
from typing import Optional


@dataclass(frozen=True)
class Location:
    """
    A Geographic location in WGS84 (Latitude/ Longitude) coordinates.
    """

    lat: float
    lon: float

    def __post_init__(self) -> None:
        if not (-90.0 <= self.lat <= 90.0):
            raise ValueError(f"Latitude must be between -90 and 90, got {self.lat}")
        if not (-180.0 <= self.lon <= 180.0):
            raise ValueError(f"Longitude bust be between -180 and 180, got {self.lon}")


@dataclass(frozen=True)
class PhenologyMetric:
    """
    Phenology metrics for a given location and year.
    This is a pure domain model (no DB or framework concerns).
    """

    year: int
    location: Location
    sos_date: Optional[date]
    eos_date: Optional[date]
    season_length: Optional[int]
    is_forest: bool


@dataclass(frozen=True)
class BoundingBox:
    """
    A WGS84 lon/lat rectangle, edges inclusive. It may not cross the antimeridian.
    """

    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float

    def __post_init__(self) -> None:
        values = (self.min_lon, self.min_lat, self.max_lon, self.max_lat)
        if not all(math.isfinite(v) for v in values):
            raise ValueError("Bounding box values must be finite numbers")
        if not (-180.0 <= self.min_lon <= self.max_lon <= 180.0):
            raise ValueError(
                "Longitudes must be within [-180, 180] with min_lon <= max_lon "
                "(boxes crossing the antimeridian are not supported)"
            )
        if not (-90.0 <= self.min_lat <= self.max_lat <= 90.0):
            raise ValueError("Latitudes must be within [-90, 90] with min_lat <= max_lat")

    def contains(self, location: Location) -> bool:
        return (
            self.min_lon <= location.lon <= self.max_lon
            and self.min_lat <= location.lat <= self.max_lat
        )

    def union(self, other: "BoundingBox") -> "BoundingBox":
        return BoundingBox(
            min_lon=min(self.min_lon, other.min_lon),
            min_lat=min(self.min_lat, other.min_lat),
            max_lon=max(self.max_lon, other.max_lon),
            max_lat=max(self.max_lat, other.max_lat),
        )


@dataclass(frozen=True)
class StoredCoverage:
    """
    Where and when stored (precomputed) metrics exist for one product.
    """

    years: tuple[int, ...]
    bbox: BoundingBox
    # Smallest spacing between stored longitudes; None with fewer than two distinct longitudes.
    grid_step_deg: Optional[float]


@dataclass(frozen=True)
class RasterCoverage:
    """
    Where and when NDVI stacks exist to compute metrics from, for one product.
    """

    years: tuple[int, ...]
    # Outer pixel edges, the union over all years.
    bbox: BoundingBox
    pixel_size_deg: float


@dataclass(frozen=True)
class NdviCurve:
    """
    An NDVI series at one pixel and the threshold-based season derived from it.
    """

    year: int
    location: Location  # as requested
    pixel: Location  # centre of the sampled pixel
    doys: tuple[int, ...]
    ndvi: tuple[float, ...]
    threshold_frac: float
    threshold_ndvi: Optional[float]  # None for a flat series
    sos_date: Optional[date]
    eos_date: Optional[date]
    season_length: Optional[int]
