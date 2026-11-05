"""
Write the synthetic NDVI raster stacks that compute mode reads.

One stack per year (2016-2026), each with 23 composites every 16 days like MODIS MOD13Q1, on
0.01 degree pixels centred from lon -1.0 to 0.0 and lat 51.0 to 52.0 (101 x 101). Pixel centres
sit on 0.01 degree multiples, so the 121 stored 0.1 degree grid points in that square are pixel
centres too and have both stored metrics and an NDVI curve.

Each pixel follows a double-logistic seasonal curve timed by the same invented model as the
stored metrics (synthetic_climate.season_doys), so computed and stored seasons roughly agree;
computed dates still land on composite days. The values are invented, not observations.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable

import numpy as np
import rasterio
from rasterio.transform import from_origin

from fpts.scripts.synthetic_climate import is_forest, season_doys, smooth_noise, stable_u01

PRODUCT = "ndvi_synth"
YEARS = tuple(range(2016, 2027))
DOYS = tuple(range(1, 366, 16))  # 1, 17, ..., 353
PIXEL_DEG = 0.01
SIZE = 101
# Outer edges: half a pixel beyond the first and last pixel centres.
WEST = -1.0 - PIXEL_DEG / 2
NORTH = 52.0 + PIXEL_DEG / 2
# The threshold method picks the first and last composite above the threshold, which on average
# lies half a composite inside the curve's midpoints. Widening the curve by that much centres the
# computed dates on the model's dates.
_HALF_COMPOSITE_DAYS = 8.0
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


def pixel_centres() -> tuple[list[float], list[float]]:
    """
    Pixel-centre latitudes (north to south, by row) and longitudes (west to east, by column),
    rounded like the stored grid's coordinates so the shared model sees identical inputs.
    """
    lats = [round(52.0 - row * PIXEL_DEG, 6) for row in range(SIZE)]
    lons = [round(-1.0 + col * PIXEL_DEG, 6) for col in range(SIZE)]
    return lats, lons


def year_composites(year: int, forest: np.ndarray) -> np.ndarray:
    """
    NDVI for every composite of one year, shape (len(DOYS), SIZE, SIZE), float32 in [0, 1].
    """
    lats, lons = pixel_centres()
    sos = np.empty((SIZE, SIZE))
    eos = np.empty((SIZE, SIZE))
    base = np.empty((SIZE, SIZE))
    amplitude = np.empty((SIZE, SIZE))
    for row, lat in enumerate(lats):
        for col, lon in enumerate(lons):
            sos[row, col], eos[row, col] = season_doys(year, lat, lon, bool(forest[row, col]))
            base[row, col] = 0.18 + 0.03 * smooth_noise(lat * 10.0, lon * 10.0, "ndvi-base")
            amplitude[row, col] = (
                0.5
                + (0.12 if forest[row, col] else 0.0)
                + 0.05 * smooth_noise(lat * 10.0, lon * 10.0, "ndvi-amplitude")
            )

    t = np.asarray(DOYS, dtype=float)[:, None, None]
    green_up = 1.0 / (1.0 + np.exp(-(t - (sos - _HALF_COMPOSITE_DAYS)) / 9.0))
    senescence = 1.0 / (1.0 + np.exp(-(t - (eos + _HALF_COMPOSITE_DAYS)) / 12.0))
    ndvi = base + amplitude * (green_up - senescence)

    # numpy's default generator gives the same stream on every platform for a given seed.
    seed = int(stable_u01(f"stack-noise|{year}") * 2**32)
    ndvi += np.random.default_rng(seed).uniform(-0.015, 0.015, size=ndvi.shape)
    return np.clip(ndvi, 0.0, 1.0).astype(np.float32)


def forest_mask() -> np.ndarray:
    lats, lons = pixel_centres()
    return np.array([[is_forest(lat, lon) for lon in lons] for lat in lats])


def write_year(out_dir: Path, year: int, forest: np.ndarray) -> None:
    transform = from_origin(west=WEST, north=NORTH, xsize=PIXEL_DEG, ysize=PIXEL_DEG)
    # Remove an older layout's composites so a stack never mixes two versions.
    for stale in out_dir.glob("doy_*.tif"):
        stale.unlink()

    for doy, arr in zip(DOYS, year_composites(year, forest), strict=True):
        write_geotiff(out_dir / f"doy_{doy:03d}.tif", arr, transform)


def is_current(product_dir: Path, years: Iterable[int]) -> bool:
    """
    True when this VERSION was written and every year holds exactly the expected composites,
    so nothing (such as an older generator run on the same volume) has changed it since.
    """
    sentinel = product_dir / ".seeded"
    if not sentinel.exists() or sentinel.read_text().strip() != VERSION:
        return False
    expected = {f"doy_{doy:03d}.tif" for doy in DOYS}
    return all(
        {p.name for p in (product_dir / str(year)).glob("doy_*.tif")} == expected for year in years
    )


def main(years: Iterable[int] = YEARS) -> None:
    years = tuple(years)
    # Use the same DATA_DIR contract as the API
    data_root = Path(os.getenv("DATA_DIR", "data"))
    product_dir = data_root / "raw" / PRODUCT

    if is_current(product_dir, years):
        print(f"Seed {VERSION} already present at {product_dir.resolve()}, skipping.")
        return

    forest = forest_mask()
    for year in years:
        write_year(product_dir / str(year), year, forest)

    (product_dir / ".seeded").write_text(f"{VERSION}\n")
    n_files = len(DOYS) * len(years)
    print(f"Wrote {n_files} NDVI rasters ({len(years)} years) to: {product_dir.resolve()}")


if __name__ == "__main__":
    main()
