from typing import Any, Optional

from fpts.cache.keys import (
    area_stats_cache_key,
    repo_point_cache_key,
    timeseries_cache_key,
)
from fpts.cache.redis_cache import RedisTTLCache
from fpts.cache.ttl_cache import InMemoryTTLCache
from fpts.domain.models import Location, PhenologyMetric
from fpts.storage.phenology_repository import PhenologyRepository
from fpts.utils.logging import get_logger

logger = get_logger("fpts.cache.QueryService")


class QueryService:
    """
    Application service for read-only phenology queries.

    The API layer will depend on this service instead of talking
    to repositories or storage directly.

    Returns metrics for a point (lat, long, year)
    """

    def __init__(
        self,
        repository: PhenologyRepository,
        *,
        point_cache: (
            RedisTTLCache[PhenologyMetric] | InMemoryTTLCache[str, PhenologyMetric] | None
        ) = None,
        timeseries_cache: (
            RedisTTLCache[list[PhenologyMetric]]
            | InMemoryTTLCache[str, list[PhenologyMetric]]
            | None
        ) = None,
        area_stats_cache: (
            RedisTTLCache[dict[str, Any]] | InMemoryTTLCache[str, dict[str, Any]] | None
        ) = None,
    ) -> None:
        self._repository = repository
        self._point_cache = point_cache
        self._area_stats_cache = area_stats_cache
        self._timeseries_cache = timeseries_cache

    def get_point_metric(
        self,
        product: str,
        location: Location,
        year: int,
    ) -> Optional[PhenologyMetric]:
        """
        Return the stored phenology metric for a single location and year, or None if not found
        """
        if self._point_cache is not None:
            key = repo_point_cache_key(product=product, year=year, location=location)
            cached = self._point_cache.get(key)
            logger.debug("cache_lookup", extra={"cache": "point_metric_repo", "key": key})
            if cached is not None:
                logger.debug("cache_hit", extra={"cache": "point_metric_repo", "key": key})
                return cached

            logger.debug("cache_miss", extra={"cache": "point_metric_repo", "key": key})

        metric = self._repository.get_metric_for_location(
            product=product, location=location, year=year
        )

        if metric is not None and self._point_cache is not None:
            self._point_cache.set(key, metric)

        return metric

    def get_point_timeseries(
        self,
        *,
        product: str,
        location: Location,
        start_year: int,
        end_year: int,
    ) -> list[PhenologyMetric]:
        if self._timeseries_cache is not None:
            key = timeseries_cache_key(
                product=product,
                location=location,
                start_year=start_year,
                end_year=end_year,
            )
            cached = self._timeseries_cache.get(key)
            logger.debug("cache_lookup", extra={"cache": "timeseries_repo", "key": key})
            if cached is not None:
                logger.debug("cache_hit", extra={"cache": "timeseries", "key": key})
                return cached

            logger.debug("cache_miss", extra={"cache": "timeseries", "key": key})

        data = self._repository.get_timeseries_for_location(
            product=product, location=location, start_year=start_year, end_year=end_year
        )

        if self._timeseries_cache is not None:
            self._timeseries_cache.set(key, data)

        return data

    def get_area_stats(
        self,
        *,
        product: str,
        year: int,
        polygon_geojson: dict,
        only_forest: bool = False,
        min_season_length: int | None = None,
        season_length_stat: str = "mean",
    ) -> dict | None:
        if self._area_stats_cache is not None:
            key = area_stats_cache_key(
                product=product,
                year=year,
                polygon_geojson=polygon_geojson,
                only_forest=only_forest,
                min_season_length=min_season_length,
                season_length_stat=season_length_stat,
            )

            cached = self._area_stats_cache.get(key)
            logger.debug("cache_lookup", extra={"cache": "area_stats_repo", "key": key})
            if cached is not None:
                logger.debug("cache_hit", extra={"cache": "area_stats", "key": key})
                return cached

            logger.debug("cache_miss", extra={"cache": "area_stats", "key": key})

        stats = self._repository.get_area_stats(
            product=product,
            year=year,
            polygon_geojson=polygon_geojson,
            only_forest=only_forest,
            min_season_length=min_season_length,
            season_length_stat=season_length_stat,
        )

        if stats is not None and self._area_stats_cache is not None:
            self._area_stats_cache.set(key, stats)

        return stats
