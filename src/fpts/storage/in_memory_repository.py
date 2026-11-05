from typing import Tuple

from fpts.domain.models import BoundingBox, Location, PhenologyMetric, StoredCoverage
from fpts.storage.phenology_repository import PhenologyRepository

Key = Tuple[str, float, float, int]  # (product, lat, lon, year)


class InMemoryPhenologyRepository(PhenologyRepository):
    """
    - test/ dev backend

    Simple in-memory implementation of PhenologyRepository.

    This is useful for:
    - Early wiring and tests
    - Unit tests where we don't want a real database
    """

    def __init__(self) -> None:
        self._store: dict[Key, PhenologyMetric] = {}

    def add_metric(self, product: str, metric: PhenologyMetric) -> None:
        key: Key = (product, metric.location.lat, metric.location.lon, metric.year)
        self._store[key] = metric

    def get_metric_for_location(
        self, product: str, location: Location, year: int
    ) -> PhenologyMetric | None:
        key: Key = (product, location.lat, location.lon, year)
        return self._store.get(key)

    def get_timeseries_for_location(
        self,
        *,
        product: str,
        location: Location,
        start_year: int,
        end_year: int,
    ) -> list[PhenologyMetric]:
        if end_year < start_year:
            return []

        items: list[tuple[int, PhenologyMetric]] = []
        for (p, lat, lon, year), metric in self._store.items():
            if (
                p == product
                and lat == location.lat
                and lon == location.lon
                and start_year <= year <= end_year
            ):
                items.append((year, metric))

        items.sort(key=lambda t: t[0])
        return [m for _, m in items]

    def get_area_stats(
        self,
        *,
        product: str,
        year: int,
        polygon_geojson: dict,
        season_length_stat: str,
    ) -> dict | None:
        # In-memory repo does not do spatial ops; keep it explicit.
        raise NotImplementedError("Area stats require PostGIS backend")

    def get_grid(
        self,
        *,
        product: str,
        year: int,
        bbox: BoundingBox | None,
        limit: int,
    ) -> list[PhenologyMetric]:
        items = [
            metric
            for (p, _lat, _lon, y), metric in self._store.items()
            if p == product and y == year and (bbox is None or bbox.contains(metric.location))
        ]
        items.sort(key=lambda m: (m.location.lat, m.location.lon))
        return items[:limit]

    def get_stored_coverage(self) -> dict[str, StoredCoverage]:
        by_product: dict[str, list[PhenologyMetric]] = {}
        for (product, _lat, _lon, _year), metric in self._store.items():
            by_product.setdefault(product, []).append(metric)

        out: dict[str, StoredCoverage] = {}
        for product, metrics in sorted(by_product.items()):
            lons = sorted({m.location.lon for m in metrics})
            lats = [m.location.lat for m in metrics]
            steps = [b - a for a, b in zip(lons, lons[1:])]
            out[product] = StoredCoverage(
                years=tuple(sorted({m.year for m in metrics})),
                bbox=BoundingBox(
                    min_lon=lons[0], min_lat=min(lats), max_lon=lons[-1], max_lat=max(lats)
                ),
                grid_step_deg=round(min(steps), 6) if steps else None,
            )
        return out
