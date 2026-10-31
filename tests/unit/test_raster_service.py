from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from fpts.domain.models import Location
from fpts.processing.raster_service import RasterService
from fpts.storage.local_raster_repository import LocalRasterRepository


def test_raster_service_samples_expected_value(tmp_path: Path):
    # Arrange: create synthetic raster
    data_dir = tmp_path
    repo = LocalRasterRepository(data_dir=data_dir)

    raster_path = repo.raw_raster_path(product="synthetic", year=2020)
    raster_path.parent.mkdir(parents=True, exist_ok=True)

    data = np.arange(100, dtype=np.int16).reshape((10, 10))
    transform = from_origin(west=-0.5, north=51.5, xsize=0.01, ysize=0.01)

    with rasterio.open(
        raster_path,
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

    service = RasterService(raster_repo=repo)

    # Pick a point near the top-left pixel
    loc = Location(lat=51.495, lon=-0.495)

    value = service.sample_point(
        product="synthetic",
        year=2020,
        location=loc,
    )

    assert value == 0
