from __future__ import annotations

import hashlib
import json

from fpts.domain.models import Location

# Keys hold exactly the inputs the uncached lookup uses (no rounding), so a cache hit always
# returns what an uncached request would. Floats are written with repr(), which round-trips.


def _f(x: float) -> str:
    # float() first so numpy scalars and ints give the same key as the equal Python float.
    return repr(float(x))


def _stable_json_hash(obj: dict) -> str:
    """
    Stable hash for GeoJSON / params dictionaries.
    Ensures identical polygons with different key order map to the same cache key.
    """
    s = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def area_stats_cache_key(
    *,
    product: str,
    year: int,
    polygon_geojson: dict,
    only_forest: bool,
    min_season_length: int | None,
    season_length_stat: str,
) -> str:
    poly_h = _stable_json_hash(polygon_geojson)
    return (
        "phenology:area_stats:"
        f"{product}:{year}:{poly_h}:only_forest={only_forest}:"
        f"min_season_length={min_season_length}:season_length_stat={season_length_stat}"
    )


def timeseries_cache_key(
    *,
    product: str,
    location: Location,
    start_year: int,
    end_year: int,
) -> str:
    return (
        f"phenology:timeseries:{product}:{_f(location.lat)}:{_f(location.lon)}:"
        f"{start_year}:{end_year}"
    )


def repo_point_cache_key(*, product: str, year: int, location: Location) -> str:
    """
    Key for a stored (repository) point metric. Stored metrics do not depend on a threshold.
    """
    return f"phenology:point:repo:{product}:{year}:{_f(location.lat)}:{_f(location.lon)}"


def compute_point_cache_key(
    *,
    product: str,
    year: int,
    location: Location,
    threshold_frac: float,
) -> str:
    """
    Key for a point metric computed from the raster stack with the given threshold.
    """
    return (
        f"phenology:point:compute:{product}:{year}:"
        f"{_f(location.lat)}:{_f(location.lon)}:{_f(threshold_frac)}"
    )
