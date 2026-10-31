from datetime import date
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from fpts.domain.models import Location
from fpts.processing.phenology_service import PhenologyComputationService
from fpts.storage.local_raster_repository import LocalRasterRepository


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


def test_compute_point_phenology_from_ndvi_stack(tmp_path: Path):
    repo = LocalRasterRepository(data_dir=tmp_path)

    doys = [1, 50, 100, 150, 200, 250, 300, 350]
    ndvi_values = [0.10, 0.12, 0.20, 0.50, 0.70, 0.60, 0.25, 0.12]
    transform = from_origin(west=-0.5, north=51.5, xsize=0.01, ysize=0.01)

    # Write files into the convention expected by list_ndvi_stack_paths
    for doy, v in zip(doys, ndvi_values, strict=True):
        p = tmp_path / "raw" / "ndvi_synth" / "2020" / f"doy_{doy:03d}.tif"
        data = np.full((10, 10), v, dtype=np.float32)
        _write_geotiff(p, data, transform)

    svc = PhenologyComputationService(raster_repo=repo)
    loc = Location(lat=51.495, lon=-0.495)

    metric = svc.compute_point_phenology(
        product="ndvi_synth", year=2020, location=loc, threshold_frac=0.5
    )

    # From earlier expectations: SOS DOY 150, EOS DOY 250
    assert metric.sos_date == date(2020, 5, 29)  # 2020-01-01 + 149 days
    assert metric.eos_date == date(2020, 9, 6)  # 2020-01-01 + 249 days
    assert metric.season_length == 100
    assert metric.is_forest is True
