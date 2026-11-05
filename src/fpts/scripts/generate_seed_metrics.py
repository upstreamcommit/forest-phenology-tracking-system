"""
Write the synthetic stored-metrics CSV that docker compose loads into PostGIS.

The values come from the invented seasonal model in synthetic_climate.py (regional gradients,
woodland clusters, a trend and yearly anomalies), rounded to whole days. Same arguments give the
same file, byte for byte.
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from fpts.scripts.synthetic_climate import clamp, is_forest, season_doys


@dataclass(frozen=True)
class Bounds:
    lon_min: float
    lon_max: float
    lat_min: float
    lat_max: float


def phenology_dates(year: int, lat: float, lon: float, forest: bool) -> tuple[date, date, int]:
    """
    SOS, EOS and season length in days for one point and year.
    """
    sos, eos = season_doys(year, lat, lon, forest)
    sos_doy = int(round(clamp(sos, 40.0, 170.0)))
    eos_doy = int(round(clamp(eos, 220.0, 345.0)))
    eos_doy = max(eos_doy, sos_doy + 60)

    sos_date = date(year, 1, 1) + timedelta(days=sos_doy - 1)
    eos_date = date(year, 1, 1) + timedelta(days=eos_doy - 1)
    return sos_date, eos_date, (eos_date - sos_date).days


def generate_points(bounds: Bounds, step_deg: float) -> list[tuple[float, float]]:
    lons = []
    x = bounds.lon_min
    while x <= bounds.lon_max + 1e-12:
        lons.append(round(x, 6))
        x += step_deg

    lats = []
    y = bounds.lat_min
    while y <= bounds.lat_max + 1e-12:
        lats.append(round(y, 6))
        y += step_deg

    return [(lon, lat) for lat in lats for lon in lons]


def _write_rows(
    path: Path,
    product: str,
    years: list[int],
    points: list[tuple[float, float]],
    forest_by_point: dict[tuple[float, float], bool],
) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "product",
                "year",
                "lon",
                "lat",
                "sos_date",
                "eos_date",
                "season_length",
                "is_forest",
            ],
        )
        w.writeheader()

        for year in years:
            for lon, lat in points:
                forest = forest_by_point[(lon, lat)]
                sos, eos, season_len = phenology_dates(year=year, lat=lat, lon=lon, forest=forest)
                w.writerow(
                    {
                        "product": product,
                        "year": year,
                        "lon": lon,
                        "lat": lat,
                        "sos_date": sos.isoformat(),
                        "eos_date": eos.isoformat(),
                        "season_length": season_len,
                        "is_forest": "true" if forest else "false",
                    }
                )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="data/seed/phenology_metrics_seed.csv")
    p.add_argument("--product", default="ndvi_synth")
    p.add_argument("--year-from", type=int, default=2018)
    p.add_argument("--year-to", type=int, default=2022)
    p.add_argument("--lon-min", type=float, default=-2.0)
    p.add_argument("--lon-max", type=float, default=2.0)
    p.add_argument("--lat-min", type=float, default=88.0)
    p.add_argument("--lat-max", type=float, default=90.0)
    p.add_argument("--step-deg", type=float, default=0.5)
    args = p.parse_args(argv)

    bounds = Bounds(args.lon_min, args.lon_max, args.lat_min, args.lat_max)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    points = generate_points(bounds, args.step_deg)
    years = list(range(args.year_from, args.year_to + 1))
    # Land cover doesn't change between years.
    forest_by_point = {(lon, lat): is_forest(lat=lat, lon=lon) for lon, lat in points}

    # Write to a temporary file first so a crash never leaves a partial CSV behind: compose only
    # generates the CSV when none exists, so a partial one would never be replaced.
    tmp_path = out_path.with_suffix(out_path.suffix + ".partial")
    try:
        _write_rows(tmp_path, args.product, years, points, forest_by_point)
        tmp_path.replace(out_path)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise

    n_rows = len(points) * len(years)
    print(f"Wrote {n_rows} rows to {out_path} for product={args.product}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
