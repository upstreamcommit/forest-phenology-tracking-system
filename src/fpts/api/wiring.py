from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from fpts.cache.codecs import (
    decode_metric,
    decode_metric_list,
    encode_metric,
    encode_metric_list,
)
from fpts.cache.redis_cache import RedisTTLCache
from fpts.cache.ttl_cache import InMemoryTTLCache
from fpts.config.settings import Settings
from fpts.domain.errors import OutOfCoverageError
from fpts.domain.models import PhenologyMetric
from fpts.processing.phenology_service import PhenologyComputationService
from fpts.processing.raster_service import RasterService
from fpts.query.catalog import CatalogService
from fpts.query.service import QueryService
from fpts.storage.in_memory_repository import InMemoryPhenologyRepository
from fpts.storage.local_raster_repository import LocalRasterRepository
from fpts.storage.postgis_phenology_repository import PostGISPhenologyRepository


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(OutOfCoverageError)
    async def out_of_coverage_handler(request: Request, exc: OutOfCoverageError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": "out_of_coverage",
                "message": "Requested location is outside dataset coverage.",
                "requested": {"lat": exc.lat, "lon": exc.lon},
                "coverage": {
                    "crs": "EPSG:4326",
                    "lon_range": [exc.x_min, exc.x_max],
                    "lat_range": [exc.y_min, exc.y_max],
                },
                "tolerance_deg": exc.tolerance_deg,
            },
        )


def wire_in_memory_services(app, settings: Settings) -> None:
    """
    Wiring for development/testing.
    """
    # Create caches
    if settings.cache_backend == "redis":
        app.state.point_metric_cache = RedisTTLCache[PhenologyMetric](
            redis_url=settings.redis_url,
            ttl_seconds=300,
            dumps=encode_metric,
            loads=lambda obj: decode_metric(obj),  # obj is dict
            key_prefix="fpts:",
        )
    else:
        app.state.point_metric_cache = InMemoryTTLCache[str, PhenologyMetric](
            maxsize=50_000, ttl_seconds=300
        )

    if settings.cache_backend == "redis":
        app.state.timeseries_cache = RedisTTLCache[list[PhenologyMetric]](
            redis_url=settings.redis_url,
            ttl_seconds=900,
            dumps=encode_metric_list,
            loads=lambda obj: decode_metric_list(obj),  # obj is list[dict]
            key_prefix="fpts:",
        )
    else:
        app.state.timeseries_cache = InMemoryTTLCache[str, list[PhenologyMetric]](
            maxsize=10_000, ttl_seconds=900
        )

    if settings.cache_backend == "redis":
        app.state.area_stats_cache = RedisTTLCache[dict[str, Any]](
            redis_url=settings.redis_url,
            ttl_seconds=3600,
            dumps=lambda obj: obj,  # already dict
            loads=lambda obj: obj,  # already dict
            key_prefix="fpts:",
        )
    else:
        app.state.area_stats_cache = InMemoryTTLCache[str, dict](
            maxsize=5_000,
            ttl_seconds=3600,
        )

    # Local raster repo to read from.
    app.state.raster_repo = LocalRasterRepository(data_dir=settings.data_dir)
    app.state.raster_service = RasterService(raster_repo=app.state.raster_repo)
    app.state.phenology_compute_service = PhenologyComputationService(
        raster_repo=app.state.raster_repo,
        point_cache=app.state.point_metric_cache,
    )

    # In memory phenology repo to store and read metrics.
    repo = InMemoryPhenologyRepository()
    app.state.phenology_repo = repo
    app.state.query_service = QueryService(
        repository=repo,
        point_cache=app.state.point_metric_cache,
        area_stats_cache=app.state.area_stats_cache,
        timeseries_cache=app.state.timeseries_cache,
    )
    app.state.catalog_service = CatalogService(repository=repo, raster_repo=app.state.raster_repo)


def wire_postgis_services(app, settings: Settings) -> None:
    """
    Wiring for Production.
    """
    # Create caches
    if settings.cache_backend == "redis":
        app.state.point_metric_cache = RedisTTLCache[PhenologyMetric](
            redis_url=settings.redis_url,
            ttl_seconds=300,
            dumps=encode_metric,
            loads=lambda obj: decode_metric(obj),  # obj is dict
            key_prefix="fpts:",
        )
    else:
        app.state.point_metric_cache = InMemoryTTLCache[str, PhenologyMetric](
            maxsize=50_000, ttl_seconds=300
        )

    if settings.cache_backend == "redis":
        app.state.timeseries_cache = RedisTTLCache[list[PhenologyMetric]](
            redis_url=settings.redis_url,
            ttl_seconds=900,
            dumps=encode_metric_list,
            loads=lambda obj: decode_metric_list(obj),  # obj is list[dict]
            key_prefix="fpts:",
        )
    else:
        app.state.timeseries_cache = InMemoryTTLCache[str, list[PhenologyMetric]](
            maxsize=10_000, ttl_seconds=900
        )

    if settings.cache_backend == "redis":
        app.state.area_stats_cache = RedisTTLCache[dict[str, Any]](
            redis_url=settings.redis_url,
            ttl_seconds=3600,
            dumps=lambda obj: obj,  # already dict
            loads=lambda obj: obj,  # already dict
            key_prefix="fpts:",
        )
    else:
        app.state.area_stats_cache = InMemoryTTLCache[str, dict](
            maxsize=5_000,
            ttl_seconds=3600,
        )

    # Local raster repo to read from.
    app.state.raster_repo = LocalRasterRepository(data_dir=settings.data_dir)
    app.state.raster_service = RasterService(raster_repo=app.state.raster_repo)
    app.state.phenology_compute_service = PhenologyComputationService(
        raster_repo=app.state.raster_repo,
        point_cache=app.state.point_metric_cache,
    )

    # PostGIS repo to store and read metrics.
    repo = PostGISPhenologyRepository(dsn=settings.database_dsn)
    app.state.phenology_repo = repo
    app.state.query_service = QueryService(
        repository=repo,
        point_cache=app.state.point_metric_cache,
        area_stats_cache=app.state.area_stats_cache,
        timeseries_cache=app.state.timeseries_cache,
    )
    app.state.catalog_service = CatalogService(repository=repo, raster_repo=app.state.raster_repo)
