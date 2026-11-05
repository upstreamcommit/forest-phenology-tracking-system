"""
Write the synthetic NDVI raster stacks that compute mode reads.

One stack per year (2016-2026), each with 23 composites every 16 days like MODIS MOD13Q1,
over a 10x10 grid of 0.01 degree pixels west of London (lon -0.5 to -0.4, lat 51.4 to 51.5).
Each pixel follows a double-logistic seasonal curve whose timing and amplitude vary smoothly
across the grid and shift with the same invented yearly anomalies as the stored metrics.
The values are invented, not observations.
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from fpts.scripts.synthetic_climate import (
    FIRST_YEAR,
    SPRING_ANOMALY_DAYS,
    SUMMER_DROUGHT_DAYS,
    smooth_noise,
    south_east_weight,
    stable_u01,
)

PRODUCT = "ndvi_synth"
YEARS = range(2016, 2027)
DOYS = tuple(range(1, 366, 16))  # 1, 17, ..., 353
WEST, NORTH, PIXEL_DEG, SIZE = -0.5, 51.5, 0.01, 10
# Bump this when the generated data changes, so existing data volumes are rewritten.
VERSION = "v2"


def write_geotiff(path: Path, data: np.ndarray, transform, crs: str = "EPSG:4326") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=data.shape[0],
        width=data.shape[1],
        count=1,
        dtype=data.dtype,
        crs=crs,
        transform=transform,
        nodata=-9999,
    ) as dst:
        dst.write(data, 1)


def pixel_ndvi(year: int, lat: float, lon: float, doy: int) -> float:
    """
    NDVI for one pixel centre and composite day: a double logistic between a winter base and a
    summer peak.
    """
    texture = smooth_noise(lat * 40.0, lon * 40.0, "stack")  # varies within the small grid
    years_on = year - FIRST_YEAR

    sos = (
        104.0
        + 6.0 * texture
        - 0.35 * years_on
        + SPRING_ANOMALY_DAYS.get(year, 0.0)
        + (stable_u01(f"stack-sos|{year}|{lat:.4f}|{lon:.4f}") - 0.5) * 6.0
    )
    eos = (
        288.0
        - 4.0 * texture
        + 0.25 * years_on
        + SUMMER_DROUGHT_DAYS.get(year, 0.0) * (0.25 + 0.75 * south_east_weight(lat, lon))
        + (stable_u01(f"stack-eos|{year}|{lat:.4f}|{lon:.4f}") - 0.5) * 6.0
    )
    base = 0.18 + 0.03 * texture
    amplitude = 0.55 + 0.08 * smooth_noise(lat * 40.0, lon * 40.0, "amplitude")

    green_up = 1.0 / (1.0 + math.exp(-(doy - sos) / 9.0))
    senescence = 1.0 / (1.0 + math.exp(-(doy - eos) / 12.0))
    noise = (stable_u01(f"stack-noise|{year}|{doy}|{lat:.4f}|{lon:.4f}") - 0.5) * 0.03
    return min(1.0, max(0.0, base + amplitude * (green_up - senescence) + noise))


def write_year(out_dir: Path, year: int) -> None:
    transform = from_origin(west=WEST, north=NORTH, xsize=PIXEL_DEG, ysize=PIXEL_DEG)
    # Remove an older layout's composites so a stack never mixes two versions.
    for stale in out_dir.glob("doy_*.tif"):
        stale.unlink()

    for doy in DOYS:
        arr = np.empty((SIZE, SIZE), dtype=np.float32)
        for row in range(SIZE):
            lat = NORTH - (row + 0.5) * PIXEL_DEG
            for col in range(SIZE):
                lon = WEST + (col + 0.5) * PIXEL_DEG
                arr[row, col] = pixel_ndvi(year, lat, lon, doy)
        write_geotiff(out_dir / f"doy_{doy:03d}.tif", arr, transform)


def main() -> None:
    # Use the same DATA_DIR contract as the API
    data_root = Path(os.getenv("DATA_DIR", "data"))
    product_dir = data_root / "raw" / PRODUCT

    # Idempotency: skip when this version is already written.
    sentinel = product_dir / ".seeded"
    if sentinel.exists() and sentinel.read_text().strip() == VERSION:
        print(f"Seed {VERSION} already present at {product_dir.resolve()}, skipping.")
        return

    for year in YEARS:
        write_year(product_dir / str(year), year)

    sentinel.write_text(f"{VERSION}\n")
    n_files = len(DOYS) * len(YEARS)
    print(f"Wrote {n_files} NDVI rasters ({len(YEARS)} years) to: {product_dir.resolve()}")


if __name__ == "__main__":
    main()
