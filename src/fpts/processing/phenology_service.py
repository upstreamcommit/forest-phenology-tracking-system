from __future__ import annotations

from datetime import date, timedelta
from typing import Optional, Sequence

import xarray as xr

from fpts.cache.keys import compute_point_cache_key
from fpts.cache.redis_cache import RedisTTLCache
from fpts.cache.ttl_cache import InMemoryTTLCache
from fpts.domain.models import Location, PhenologyMetric
from fpts.processing.ndvi_stack import (
    extract_ndvi_timeseries,
    extract_ndvi_timeseries_batch,
    load_ndvi_stack,
)
from fpts.processing.phenology_algorithm import (
    DEFAULT_THRESHOLD_FRAC,
    compute_sos_eos_threshold,
)
from fpts.storage.raster_repository import RasterRepository
from fpts.utils.logging import get_logger

logger = get_logger("fpts.cache.PhenologyService")


def _date_from_doy(year: int, doy: int) -> date:
    return date(year, 1, 1) + timedelta(days=doy - 1)


class PhenologyComputationService:
    """
    Computes phenology metrics for a given location using an NDVI raster time stack.

    Includes:
        - a small in-memory cache of loaded stacks keyed by (product, year)
        - caching for computing point phenology
    """

    def __init__(
        self,
        raster_repo: RasterRepository,
        point_cache: (
            RedisTTLCache[PhenologyMetric] | InMemoryTTLCache[str, PhenologyMetric] | None
        ) = None,
    ) -> None:
        self._raster_repo = raster_repo
        self._stack_cache: dict[tuple[str, int], xr.DataArray] = {}
        self._point_cache = point_cache

    def compute_point_phenology(
        self,
        product: str,
        year: int,
        location: Location,
        threshold_frac: float = DEFAULT_THRESHOLD_FRAC,
        is_forest: bool = True,
    ) -> PhenologyMetric:
        point_cache_key = compute_point_cache_key(
            product=product,
            year=year,
            location=location,
            threshold_frac=threshold_frac,
        )

        if self._point_cache is not None:
            cached = self._point_cache.get(point_cache_key)
            logger.debug(
                "cache_lookup",
                extra={"cache": "point_metric_compute", "key": point_cache_key},
            )
            if cached is not None:
                logger.debug(
                    "cache_hit",
                    extra={"cache": "point_metric_compute", "key": point_cache_key},
                )
                return cached

            logger.debug(
                "cache_miss",
                extra={"cache": "point_metric_compute", "key": point_cache_key},
            )

        stack_cache_key = (product, year)

        if stack_cache_key in self._stack_cache:
            stack = self._stack_cache[stack_cache_key]

        else:
            paths = self._raster_repo.list_ndvi_stack_paths(product=product, year=year)
            if not paths:
                raise FileNotFoundError(
                    f"No NDVI stack files found for product={product}, year={year}"
                )
            stack = load_ndvi_stack(paths)
            self._stack_cache[stack_cache_key] = stack

        time_series = extract_ndvi_timeseries(stack, location)

        dates = compute_sos_eos_threshold(
            ndvi=time_series.ndvi, doys=time_series.doys, frac=threshold_frac
        )

        sos_date: Optional[date] = _date_from_doy(year, dates.sos_doy) if dates.sos_doy else None
        eos_date: Optional[date] = _date_from_doy(year, dates.eos_doy) if dates.eos_doy else None

        metric = PhenologyMetric(
            year=year,
            location=location,
            sos_date=sos_date,
            eos_date=eos_date,
            season_length=dates.season_length,
            is_forest=is_forest,
        )

        if self._point_cache is not None:
            self._point_cache.set(point_cache_key, metric)

        return metric

    def compute_points_phenology(
        self,
        product: str,
        year: int,
        locations: Sequence[Location],
        threshold_frac: float = DEFAULT_THRESHOLD_FRAC,
        is_forest: bool = True,
    ) -> list[PhenologyMetric]:
        """
        Batch compute phenology metrics for many points.

        Key optimization:
            - load stack once (cached by (product, year))
            - sample all points in one vectorized operation
        """
        if not locations:
            return []

        key = (product, year)

        if key in self._stack_cache:
            stack = self._stack_cache[key]
        else:
            paths = self._raster_repo.list_ndvi_stack_paths(product=product, year=year)
            if not paths:
                raise FileNotFoundError(
                    f"No NDVI stack files found for product={product}, year={year}"
                )
            stack = load_ndvi_stack(paths)
            self._stack_cache[key] = stack

        series_list = extract_ndvi_timeseries_batch(stack, locations)

        metrics: list[PhenologyMetric] = []
        for loc, ts in zip(locations, series_list, strict=True):
            dates = compute_sos_eos_threshold(ndvi=ts.ndvi, doys=ts.doys, frac=threshold_frac)

            sos_date: Optional[date] = (
                _date_from_doy(year, dates.sos_doy) if dates.sos_doy else None
            )
            eos_date: Optional[date] = (
                _date_from_doy(year, dates.eos_doy) if dates.eos_doy else None
            )

            metrics.append(
                PhenologyMetric(
                    year=year,
                    location=loc,
                    sos_date=sos_date,
                    eos_date=eos_date,
                    season_length=dates.season_length,
                    is_forest=is_forest,
                )
            )

        return metrics
