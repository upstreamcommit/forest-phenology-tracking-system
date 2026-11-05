from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import rasterio
import rasterio.errors
import rioxarray
import xarray as xr

from fpts.domain.errors import OutOfCoverageError
from fpts.domain.models import Location

_DOY_RE = re.compile(r"doy_(\d{3})\.tif$")
# Far below any pixel size, far above float noise in coordinates near 1e2 degrees (~1e-14).
_EDGE_SLACK_DEG = 1e-9


@dataclass(frozen=True)
class NdviTimeSeries:
    doys: list[int]
    ndvi: list[float]
    # Centre of the sampled pixel, when known.
    pixel: Location | None = None


@dataclass(frozen=True)
class RasterExtent:
    crs: str | None
    # Outer pixel edges in CRS units: min_x, min_y, max_x, max_y.
    bounds: tuple[float, float, float, float]
    # Pixel width and height in CRS units.
    pixel_size: tuple[float, float]


def raster_extent(path: Path) -> RasterExtent:
    """
    Read a GeoTIFF's CRS, outer bounds and pixel size from its header (no pixel data).
    Raises ValueError when the file can't be read as a raster.
    """
    try:
        with rasterio.open(path) as src:
            b = src.bounds
            return RasterExtent(
                crs=src.crs.to_string() if src.crs else None,
                bounds=(b.left, b.bottom, b.right, b.top),
                pixel_size=(abs(src.res[0]), abs(src.res[1])),
            )
    except rasterio.errors.RasterioError as e:
        raise ValueError(f"Unreadable raster {path.name}: {e}") from e


def _doy_from_filename(path: Path) -> int:
    match = _DOY_RE.search(path.name)
    if not match:
        raise ValueError(f"Unexpected NDVI filename format: {path.name}")
    return int(match.group(1))


def load_ndvi_stack(paths: Sequence[Path]) -> xr.DataArray:
    """
    Load multiple single-band GeoTIFFs into a time-stacked DataArray.
    Output dims: time, band, y, x
    """
    if not paths:
        raise ValueError("Paths must not be empty")

    # sort by DOY so time is in order
    sorted_paths = sorted(paths, key=_doy_from_filename)
    rasters = [rioxarray.open_rasterio(path) for path in sorted_paths]  # each: band, y, x

    stack = xr.concat(rasters, dim="time")  # time, band, y, x
    stack = stack.assign_coords(time=[_doy_from_filename(path) for path in sorted_paths])
    return stack


def extract_ndvi_timeseries(
    stack: xr.DataArray, location: Location, *, tolerance_deg: float = 0.005
) -> NdviTimeSeries:
    """
    Extract NDVI values across time at a given lat/lon (nearest pixel).
    Assumes x=lon, y=lat (EPSG:4326 in our synthetic data).
    """
    x_min = float(stack["x"].min())
    x_max = float(stack["x"].max())
    y_min = float(stack["y"].min())
    y_max = float(stack["y"].max())

    try:
        sampled = stack.sel(
            x=location.lon,
            y=location.lat,
            method="nearest",
            # A point on the outer edge is exactly one tolerance from the edge pixel's centre;
            # without the slack, float noise in the pixel coordinates rejects some edges.
            tolerance=tolerance_deg + _EDGE_SLACK_DEG,
        )
    except KeyError as e:
        raise OutOfCoverageError(
            lat=location.lat,
            lon=location.lon,
            tolerance_deg=tolerance_deg,
            x_min=x_min,
            x_max=x_max,
            y_min=y_min,
            y_max=y_max,
        ) from e

    values = sampled.isel(band=0).values
    doys = [int(time) for time in sampled["time"].values.tolist()]
    ndvi = [float(val) for val in values.tolist()]
    pixel = Location(lat=float(sampled["y"]), lon=float(sampled["x"]))
    return NdviTimeSeries(doys=doys, ndvi=ndvi, pixel=pixel)


def extract_ndvi_timeseries_batch(
    stack: xr.DataArray, locations: Sequence[Location]
) -> list[NdviTimeSeries]:
    """
    Vectorized extraction for many lat/lon points (nearest pixel).

    Returns one NdviTimeSeries per input location in the same order.
    """
    if not locations:
        return []

    lons = [loc.lon for loc in locations]
    lats = [loc.lat for loc in locations]

    # dims after sel: time, band, points
    sampled = stack.sel(
        x=xr.DataArray(lons, dims="points"),
        y=xr.DataArray(lats, dims="points"),
        method="nearest",
    )

    values = sampled.isel(band=0).values  # shape: (time, points)
    doys = [int(t) for t in sampled["time"].values.tolist()]

    out: list[NdviTimeSeries] = []
    for i in range(len(locations)):
        ndvi = [float(v) for v in values[:, i].tolist()]
        out.append(NdviTimeSeries(doys=doys, ndvi=ndvi))
    return out
