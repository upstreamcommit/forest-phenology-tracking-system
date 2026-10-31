from pathlib import Path

import numpy as np
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin

from fpts.api.main import create_app
from fpts.config.settings import Settings


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


def test_point_compute_in_bounds_returns_200(tmp_path: Path) -> None:
    app = create_app(Settings(data_dir=str(tmp_path)))

    # Create NDVI stack under tmp_path/raw/ndvi_synth/2020/doy_*.tif
    doys = [1, 50, 100, 150, 200, 250, 300, 350]
    ndvi_values = [0.10, 0.12, 0.20, 0.50, 0.70, 0.60, 0.25, 0.12]
    transform = from_origin(west=-0.5, north=51.5, xsize=0.01, ysize=0.01)

    for doy, v in zip(doys, ndvi_values, strict=True):
        p = tmp_path / "raw" / "ndvi_synth" / "2020" / f"doy_{doy:03d}.tif"
        data = np.full((10, 10), v, dtype=np.float32)
        _write_geotiff(p, data, transform)

    client = TestClient(app)
    resp = client.get(
        "/phenology/point",
        params={
            "product": "ndvi_synth",
            "year": 2020,
            "lat": 51.495,
            "lon": -0.495,
            "mode": "compute",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["year"] == 2020
    assert body["location"]["lat"] == 51.495
    assert body["location"]["lon"] == -0.495


def test_point_compute_out_of_bounds_returns_422(tmp_path: Path) -> None:
    app = create_app(Settings(data_dir=str(tmp_path)))

    # Create NDVI stack under tmp_path/raw/ndvi_synth/2020/doy_*.tif
    doys = [1, 50, 100, 150, 200, 250, 300, 350]
    ndvi_values = [0.10, 0.12, 0.20, 0.50, 0.70, 0.60, 0.25, 0.12]
    transform = from_origin(west=-0.5, north=51.5, xsize=0.01, ysize=0.01)

    for doy, v in zip(doys, ndvi_values, strict=True):
        p = tmp_path / "raw" / "ndvi_synth" / "2020" / f"doy_{doy:03d}.tif"
        data = np.full((10, 10), v, dtype=np.float32)
        _write_geotiff(p, data, transform)

    client = TestClient(app)

    resp = client.get(
        "/phenology/point",
        params={
            "product": "ndvi_synth",
            "year": 2020,
            "lat": 89.495,
            "lon": -1.495,
            "mode": "compute",
        },
    )
    assert resp.status_code == 422, resp.text
    body = resp.json()

    assert body["error"] == "out_of_coverage"
    assert body["requested"] == {"lat": 89.495, "lon": -1.495}

    cov = body["coverage"]
    assert cov["crs"] == "EPSG:4326"
    assert cov["lon_range"][0] < cov["lon_range"][1]
    assert cov["lat_range"][0] < cov["lat_range"][1]
    assert "tolerance_deg" in body
