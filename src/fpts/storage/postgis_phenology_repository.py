from __future__ import annotations

from typing import Iterable

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

from fpts.domain.models import BoundingBox, Location, PhenologyMetric, StoredCoverage
from fpts.sql.queries.phenology import (
    GET_AREA_STATS,
    GET_GRID,
    GET_METRIC_FOR_LOCATION,
    GET_STORED_COVERAGE,
    GET_TIMESERIES_FOR_LOCATION,
    UPSERT_MANY,
)
from fpts.storage.phenology_repository import PhenologyRepository

_WHOLE_WORLD = BoundingBox(min_lon=-180.0, min_lat=-90.0, max_lon=180.0, max_lat=90.0)


class PostGISPhenologyRepository(PhenologyRepository):
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    def _connect(self):
        return psycopg.connect(self._dsn, row_factory=dict_row)

    def upsert(self, *, product: str, metric: PhenologyMetric) -> None:
        self.upsert_many(product=product, metrics=[metric])

    def upsert_many(self, *, product: str, metrics: Iterable[PhenologyMetric]) -> None:
        sql = UPSERT_MANY

        with self._connect() as conn:
            with conn.cursor() as cur:
                for metric in metrics:
                    cur.execute(
                        sql,
                        {
                            "product": product,
                            "year": metric.year,
                            "lon": metric.location.lon,
                            "lat": metric.location.lat,
                            "sos_date": metric.sos_date,
                            "eos_date": metric.eos_date,
                            "season_length": metric.season_length,
                            "is_forest": metric.is_forest,
                        },
                    )

    def get_metric_for_location(
        self,
        *,
        product: str,
        location: Location,
        year: int,
    ) -> PhenologyMetric | None:
        sql = GET_METRIC_FOR_LOCATION

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    sql,
                    {
                        "year": year,
                        "product": product,
                        "lon": location.lon,
                        "lat": location.lat,
                    },
                )
                row = cur.fetchone()
                if row is None:
                    return None

                return PhenologyMetric(
                    year=int(row["year"]),
                    location=Location(lat=float(row["lat"]), lon=float(row["lon"])),
                    sos_date=row["sos_date"],
                    eos_date=row["eos_date"],
                    season_length=row["season_length"],
                    is_forest=row["is_forest"],
                )

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

        sql = GET_TIMESERIES_FOR_LOCATION

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    sql,
                    {
                        "product": product,
                        "lat": location.lat,
                        "lon": location.lon,
                        "start_year": start_year,
                        "end_year": end_year,
                    },
                )
                rows = cur.fetchall() or []

        out: list[PhenologyMetric] = []
        for row in rows:
            out.append(
                PhenologyMetric(
                    year=int(row["year"]),
                    location=Location(lat=float(row["lat"]), lon=float(row["lon"])),
                    sos_date=row["sos_date"],
                    eos_date=row["eos_date"],
                    season_length=row["season_length"],
                    is_forest=row["is_forest"],
                )
            )
        return out

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
        if season_length_stat not in {"mean", "median", "both"}:
            raise ValueError("Invalid season_length_stat")

        sql = GET_AREA_STATS

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    sql,
                    {
                        "product": product,
                        "year": year,
                        "poly": Json(polygon_geojson),
                        "only_forest": only_forest,
                        "min_season_length": min_season_length,
                    },
                )
                row = cur.fetchone()

        # row should always exist because flags yields 1 row
        if row is None or row["ok"] is not True:
            raise ValueError("Invalid GeoJSON geometry")

        if row["n"] == 0:
            return None

        out = {
            "n": int(row["n"]),
            "forest_fraction": row["forest_fraction"],
        }

        if season_length_stat in {"mean", "both"}:
            out["mean_season_length"] = row["mean_season_length"]
        if season_length_stat in {"median", "both"}:
            out["median_season_length"] = row["median_season_length"]

        return out

    def get_grid(
        self,
        *,
        product: str,
        year: int,
        bbox: BoundingBox | None,
        limit: int,
    ) -> list[PhenologyMetric]:
        box = bbox or _WHOLE_WORLD

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    GET_GRID,
                    {
                        "product": product,
                        "year": year,
                        "min_lon": box.min_lon,
                        "min_lat": box.min_lat,
                        "max_lon": box.max_lon,
                        "max_lat": box.max_lat,
                        "limit": limit,
                    },
                )
                rows = cur.fetchall() or []

        return [
            PhenologyMetric(
                year=int(row["year"]),
                location=Location(lat=float(row["lat"]), lon=float(row["lon"])),
                sos_date=row["sos_date"],
                eos_date=row["eos_date"],
                season_length=row["season_length"],
                is_forest=row["is_forest"],
            )
            for row in rows
        ]

    def get_stored_coverage(self) -> dict[str, StoredCoverage]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(GET_STORED_COVERAGE)
                rows = cur.fetchall() or []

        return {
            row["product"]: StoredCoverage(
                years=tuple(int(y) for y in row["years"]),
                bbox=BoundingBox(
                    min_lon=float(row["min_lon"]),
                    min_lat=float(row["min_lat"]),
                    max_lon=float(row["max_lon"]),
                    max_lat=float(row["max_lat"]),
                ),
                grid_step_deg=(
                    round(float(row["grid_step_deg"]), 6)
                    if row["grid_step_deg"] is not None
                    else None
                ),
            )
            for row in rows
        }
