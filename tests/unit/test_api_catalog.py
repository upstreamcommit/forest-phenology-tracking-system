"""GET /catalog and CatalogService: what stored and computable data the API reports."""

from datetime import date
from pathlib import Path

import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin

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


def _write_stack(root: Path, product: str, year: int, crs: str = "EPSG:4326") -> None:
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
        transform=from_origin(west=1.0, north=50.0, xsize=0.5, ysize=0.5),
    ) as dst:
        dst.write(np.zeros((2, 3), dtype=np.float32), 1)


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


def test_reports_stored_years_extent_and_grid_step(tmp_path):
    repo = InMemoryPhenologyRepository()
    for year in (2018, 2016):
        for lat, lon in [(51.5, -0.5), (51.6, -0.4), (51.5, -0.3)]:
            repo.add_metric("ndvi_synth", _metric(year, lat, lon))
    repo.add_metric("single_point", _metric(2020, 10.0, 10.0))

    [synth, single] = CatalogService(repo, LocalRasterRepository(tmp_path)).list_products()

    assert synth.product == "ndvi_synth"
    assert synth.stored.years == (2016, 2018)
    assert (synth.stored.bbox.min_lon, synth.stored.bbox.max_lon) == (-0.5, -0.3)
    assert (synth.stored.bbox.min_lat, synth.stored.bbox.max_lat) == (51.5, 51.6)
    assert synth.stored.grid_step_deg == pytest.approx(0.1)
    assert synth.computed is None
    assert single.product == "single_point"
    assert single.stored.grid_step_deg is None


def test_unions_stack_extents_across_years_and_skips_non_wgs84_stacks(tmp_path):
    _write_stack(tmp_path, "p", 2020)
    _write_stack(tmp_path, "p", 2021)
    _write_stack(tmp_path, "projected", 2020, crs="EPSG:3857")
    (tmp_path / "raw" / "p" / "notes").mkdir()  # not a year
    (tmp_path / "raw" / "p" / "2022").mkdir()  # a year with no composites

    entries = CatalogService(
        InMemoryPhenologyRepository(), LocalRasterRepository(tmp_path)
    ).list_products()

    [p] = entries
    assert p.product == "p"
    assert p.computed.years == (2020, 2021)
    bbox = p.computed.bbox
    assert (bbox.min_lon, bbox.min_lat, bbox.max_lon, bbox.max_lat) == (1.0, 49.0, 2.5, 50.0)
    assert p.computed.pixel_size_deg == 0.5


def test_results_are_cached_until_the_ttl_expires(tmp_path):
    repo = InMemoryPhenologyRepository()
    service = CatalogService(repo, LocalRasterRepository(tmp_path), ttl_seconds=60)
    assert service.list_products() == []

    repo.add_metric("ndvi_synth", _metric(2020, 51.5, -0.5))

    assert service.list_products() == []
    fresh = CatalogService(repo, LocalRasterRepository(tmp_path)).list_products()
    assert [e.product for e in fresh] == ["ndvi_synth"]
