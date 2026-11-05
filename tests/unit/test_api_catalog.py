"""GET /catalog and CatalogService: what stored and computable data the API reports."""

import time
from datetime import date
from pathlib import Path

import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin

from fpts.api.main import create_app
from fpts.config.settings import Settings
from fpts.domain.models import Location, PhenologyMetric
from fpts.query.catalog import CatalogService
from fpts.storage.in_memory_repository import InMemoryPhenologyRepository
from fpts.storage.local_raster_repository import LocalRasterRepository


def _metric(year: int, lat: float, lon: float) -> PhenologyMetric:
    return PhenologyMetric(
        year=year,
        location=Location(lat=lat, lon=lon),
        sos_date=date(year, 4, 1),
        eos_date=date(year, 10, 1),
        season_length=183,
        is_forest=True,
    )


def _write_stack(
    root: Path,
    product: str,
    year: int,
    *,
    crs: str = "EPSG:4326",
    west: float = 1.0,
    north: float = 50.0,
    size: float = 0.5,
) -> Path:
    path = root / "raw" / product / str(year) / "doy_001.tif"
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=2,
        width=3,
        count=1,
        dtype="float32",
        crs=crs,
        transform=from_origin(west=west, north=north, xsize=size, ysize=size),
    ) as dst:
        dst.write(np.zeros((2, 3), dtype=np.float32), 1)
    return path


def _service(root: Path, repo: InMemoryPhenologyRepository | None = None, **kwargs):
    return CatalogService(
        repo or InMemoryPhenologyRepository(), LocalRasterRepository(root), **kwargs
    )


def test_lists_the_fixture_stacks_with_their_extent(app_memory):
    resp = TestClient(app_memory).get("/catalog")

    assert resp.status_code == 200
    body = resp.json()
    assert body["default_threshold_frac"] == 0.5
    products = {p["id"]: p for p in body["products"]}
    assert set(products) == {"mod13q1", "ndvi_synth"}

    synth = products["ndvi_synth"]
    assert synth["label"] == "Synthetic NDVI"
    assert synth["synthetic"] is True
    assert synth["stored"] is None  # the memory backend starts empty
    assert synth["computed"] == {
        "years": [2020],
        "bbox": [-0.5, 51.4, -0.4, 51.5],
        "pixel_size_deg": 0.01,
    }
    # Not registered, so its origin is unknown rather than claimed to be real.
    assert products["mod13q1"]["synthetic"] is None
    assert products["mod13q1"]["label"] == "mod13q1"


def test_reports_stored_years_extent_and_smallest_grid_step(tmp_path):
    repo = InMemoryPhenologyRepository()
    for year in (2018, 2016):
        # Uneven longitude gaps (0.2 then 0.1): the step is the smallest.
        for lat, lon in [(51.5, -0.5), (51.6, -0.3), (51.5, -0.2)]:
            repo.add_metric("ndvi_synth", _metric(year, lat, lon))
    repo.add_metric("single_point", _metric(2020, 10.0, 10.0))
    # Longitudes that differ only by float noise are one longitude.
    repo.add_metric("noisy", _metric(2020, 10.0, 0.3))
    repo.add_metric("noisy", _metric(2020, 10.1, 0.30000000000000004))

    [synth, noisy, single] = _service(tmp_path, repo).list_products()

    assert synth.product == "ndvi_synth"
    assert synth.stored.years == (2016, 2018)
    assert (synth.stored.bbox.min_lon, synth.stored.bbox.max_lon) == (-0.5, -0.2)
    assert (synth.stored.bbox.min_lat, synth.stored.bbox.max_lat) == (51.5, 51.6)
    assert synth.stored.grid_step_deg == pytest.approx(0.1)
    assert synth.computed is None
    assert single.stored.grid_step_deg is None
    assert noisy.stored.grid_step_deg is None


def test_stored_bbox_is_returned_unrounded_so_it_can_be_passed_to_the_grid(tmp_path):
    app = create_app(Settings(phenology_repo_backend="memory", data_dir=str(tmp_path)))
    awkward_lons = [(i + 0.5) / 48 for i in range(3)]  # 0.0104166..., not terminating
    for lon in awkward_lons:
        app.state.phenology_repo.add_metric("p", _metric(2020, 51.123456789012, lon))
    client = TestClient(app)

    bbox = client.get("/catalog").json()["products"][0]["stored"]["bbox"]
    grid = client.get(
        "/phenology/grid",
        params={"product": "p", "year": 2020, "bbox": ",".join(repr(v) for v in bbox)},
    )

    assert bbox == [awkward_lons[0], 51.123456789012, awkward_lons[-1], 51.123456789012]
    assert len(grid.json()["features"]) == 3


def test_unions_stack_extents_across_years(tmp_path):
    _write_stack(tmp_path, "p", 2020)  # lon 1.0..2.5, lat 49.0..50.0
    _write_stack(tmp_path, "p", 2021, west=2.0, north=49.5)  # lon 2.0..3.5, lat 48.5..49.5

    [p] = _service(tmp_path).list_products()

    assert p.computed.years == (2020, 2021)
    bbox = p.computed.bbox
    assert (bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat) == (1.0, 48.5, 3.5, 50.0)
    assert p.computed.pixel_size_deg == 0.5


def test_raster_bounds_lose_their_float_noise_in_the_response(tmp_path):
    _write_stack(tmp_path, "p", 2020, west=0.1 + 0.2, size=0.1)  # west is 0.30000000000000004

    resp = TestClient(
        create_app(Settings(phenology_repo_backend="memory", data_dir=str(tmp_path)))
    ).get("/catalog")

    assert resp.json()["products"][0]["computed"]["bbox"][0] == 0.3


def test_skips_stacks_it_cannot_use_and_still_lists_the_others(tmp_path):
    _write_stack(tmp_path, "good", 2020)
    _write_stack(tmp_path, "projected", 2020, crs="EPSG:3857")
    _write_stack(tmp_path, "out_of_range", 2020, west=179.5)  # east edge beyond 180
    corrupt = tmp_path / "raw" / "corrupt" / "2020" / "doy_001.tif"
    corrupt.parent.mkdir(parents=True)
    corrupt.write_bytes(b"not a tiff")
    _write_stack(tmp_path, ".hidden", 2020)
    _write_stack(tmp_path, "good", 2021)
    (tmp_path / "raw" / "good" / "notes").mkdir()  # not a year
    (tmp_path / "raw" / "good" / "2022").mkdir()  # a year with no composites
    superscript = tmp_path / "raw" / "good" / "20²0" / "doy_001.tif"  # "²".isdigit() is True
    superscript.parent.mkdir()
    superscript.write_bytes((tmp_path / "raw" / "good" / "2020" / "doy_001.tif").read_bytes())

    entries = _service(tmp_path).list_products()

    assert [e.product for e in entries] == ["good"]
    assert entries[0].computed.years == (2020, 2021)


def test_results_are_cached_until_the_ttl_expires(tmp_path):
    repo = InMemoryPhenologyRepository()
    service = _service(tmp_path, repo, ttl_seconds=0.05)
    assert service.list_products() == []

    repo.add_metric("ndvi_synth", _metric(2020, 51.5, -0.5))
    assert service.list_products() == []  # still cached

    time.sleep(0.1)
    assert [e.product for e in service.list_products()] == ["ndvi_synth"]
