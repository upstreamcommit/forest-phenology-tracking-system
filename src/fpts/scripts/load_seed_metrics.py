from __future__ import annotations

import argparse
import csv
import os
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable

import psycopg

from fpts.domain.models import Location, PhenologyMetric
from fpts.storage.postgis_phenology_repository import PostGISPhenologyRepository


@dataclass(frozen=True)
class SeedRow:
    product: str
    year: int
    lon: float
    lat: float
    sos_date: date
    eos_date: date
    season_length: int
    is_forest: bool


def wait_for_db(dsn: str, *, timeout_s: int = 60, interval_s: float = 1.0) -> None:
    """
    Retry until Postgres accepts TCP connections.
    This protects against container startup races even when depends_on/healthchecks exist.
    """
    deadline = time.time() + timeout_s
    last_err: Exception | None = None

    while time.time() < deadline:
        try:
            with psycopg.connect(dsn) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1;")
            return
        except psycopg.OperationalError as e:
            last_err = e
            time.sleep(interval_s)

    raise SystemExit(f"Database not ready after {timeout_s}s. Last error: {last_err}")


def _parse_bool(s: str) -> bool:
    return s.strip().lower() in {"1", "true", "t", "yes", "y"}


def read_rows(csv_path: Path) -> Iterable[SeedRow]:
    with csv_path.open("r", newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            yield SeedRow(
                product=row["product"],
                year=int(row["year"]),
                lon=float(row["lon"]),
                lat=float(row["lat"]),
                sos_date=date.fromisoformat(row["sos_date"]),
                eos_date=date.fromisoformat(row["eos_date"]),
                season_length=int(row["season_length"]),
                is_forest=_parse_bool(row["is_forest"]),
            )


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--csv", required=True, help="Path to phenology_metrics_seed.csv")
    p.add_argument("--dsn", default=os.getenv("DATABASE_DSN", ""), help="PostGIS DSN")
    p.add_argument("--batch-size", type=int, default=2000)
    args = p.parse_args()

    if not args.dsn:
        raise SystemExit("DATABASE_DSN is required (or pass --dsn).")

    wait_for_db(args.dsn, timeout_s=90, interval_s=1.0)

    csv_path = Path(args.csv)
    if not csv_path.exists():
        raise SystemExit(f"Seed file not found: {csv_path}")

    repo = PostGISPhenologyRepository(dsn=args.dsn)

    batch: list[PhenologyMetric] = []
    current_product: str | None = None

    def flush(product: str) -> None:
        nonlocal batch
        if batch:
            repo.upsert_many(product=product, metrics=batch)
            batch = []

    for srow in read_rows(csv_path):
        if current_product is None:
            current_product = srow.product
        elif srow.product != current_product:
            # If you ever generate multiple products into one CSV, flush between them.
            flush(current_product)
            current_product = srow.product

        batch.append(
            PhenologyMetric(
                year=srow.year,
                location=Location(lat=srow.lat, lon=srow.lon),
                sos_date=srow.sos_date,
                eos_date=srow.eos_date,
                season_length=srow.season_length,
                is_forest=srow.is_forest,
            )
        )

        if len(batch) >= args.batch_size:
            flush(current_product)

    if current_product is not None:
        flush(current_product)

    print(f"Loaded seed metrics from {csv_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
