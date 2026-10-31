from pathlib import Path

import numpy as np
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin

from fpts.api.main import create_app
from fpts.config.settings import Settings


def test_debug_raster_sample_endpoint(tmp_path: Path):
    app = create_app(Settings(data_dir=str(tmp_path), enable_debug_routes=True))

    # Create raster in expected location
    raster_path = tmp_path / "raw" / "synthetic" / "2020.tif"
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

    client = TestClient(app)
    resp = client.get(
        "/debug/raster-sample",
        params={"product": "synthetic", "year": 2020, "lat": 51.495, "lon": -0.495},
    )

    assert resp.status_code == 200
    assert resp.json()["value"] == 0
