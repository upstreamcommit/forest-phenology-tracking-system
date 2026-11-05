from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from fpts.domain.models import BoundingBox, Location, PhenologyMetric, StoredCoverage

# Longitude gaps smaller than this are float noise, not grid spacing.
MIN_GRID_STEP_DEG = 1e-9


class PhenologyRepository(ABC):
    """
    Abstract interface for storing and retrieving phenology metrics.

    To add:
    - get_timeseries_for_location
    - get_area_stats
    - upsert_metrics
    """

    @abstractmethod
    def get_metric_for_location(
        self, *, product: str, location: Location, year: int
    ) -> Optional[PhenologyMetric]:
        """
        Return phenology metrics for a single product, location and year,
        or None if no data is available.
        """
        raise NotImplementedError

    @abstractmethod
    def get_timeseries_for_location(
        self,
        *,
        product: str,
        location: Location,
        start_year: int,
        end_year: int,
    ) -> list[PhenologyMetric]:
        """
        Return metrics for a single product and location across a year range (inclusive).
        Returns an empty list if no data is available.
        """
        raise NotImplementedError

    @abstractmethod
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
        """
        Aggregated stats for points intersecting polygon.
        Returns None if no rows matched.
        """
        raise NotImplementedError

    @abstractmethod
    def get_grid(
        self,
        *,
        product: str,
        year: int,
        bbox: BoundingBox | None,
        limit: int,
    ) -> list[PhenologyMetric]:
        """
        Return stored metrics for one product and year, inside bbox (edges inclusive) or
        everywhere when bbox is None. Ordered by lat then lon, at most `limit` rows.
        """
        raise NotImplementedError

    @abstractmethod
    def get_stored_coverage(self) -> dict[str, StoredCoverage]:
        """
        Return the years, extent and grid spacing of stored metrics, keyed by product.
        """
        raise NotImplementedError
