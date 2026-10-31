from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from fpts.domain.models import Location
from fpts.processing.ndvi_stack import extract_ndvi_timeseries, load_ndvi_stack
from fpts.processing.phenology_algorithm import compute_sos_eos_threshold


def _write_geotiff(path: Path, data: np.ndarray, transform) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=data.shape[0],
        width=data.shape[1],
        count=1,
        dtype=data.dtype,
        crs="EPSG:4326",
        transform=transform,
        nodata=-9999,
    ) as dst:
        dst.write(data, 1)


def test_stack_to_timeseries_to_sos_eos(tmp_path: Path):
    # Arrange: create a tiny NDVI stack in tmp_path
    doys = [1, 50, 100, 150, 200, 250, 300, 350]
    ndvi_values = [0.10, 0.12, 0.20, 0.50, 0.70, 0.60, 0.25, 0.12]

    transform = from_origin(west=-0.5, north=51.5, xsize=0.01, ysize=0.01)

    paths: list[Path] = []
    for doy, ndvi_val in zip(doys, ndvi_values, strict=True):
        path = tmp_path / "raw" / "ndvi_synth" / "2020" / f"doy_{doy:03d}.tif"
        data = np.full((10, 10), ndvi_val, dtype=np.float32)
        _write_geotiff(path, data, transform)
        paths.append(path)

    # Act: load stack and extract NDVI time series
    stack = load_ndvi_stack(paths)
    loc = Location(lat=51.495, lon=-0.495)  # near top-left
    time_series = extract_ndvi_timeseries(stack, loc)

    # Assert: time series matches our input
    assert time_series.doys == doys
    assert [round(x, 3) for x in time_series.ndvi] == [round(x, 3) for x in ndvi_values]

    # Compute phenology (same expectation as earlier algorithm test)
    result = compute_sos_eos_threshold(ndvi=time_series.ndvi, doys=time_series.doys, frac=0.5)
    assert result.sos_doy == 150
    assert result.eos_doy == 250
    assert result.season_length == 100
