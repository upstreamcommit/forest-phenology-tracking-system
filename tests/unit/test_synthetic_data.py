"""The synthetic seed CSV and NDVI stacks that docker compose generates.

They are demo data, but the UI and the README examples depend on their shape: plausible
ranges, real spatial and year-to-year variation, determinism, and safe reruns.
"""

import csv
import statistics
from datetime import date
from pathlib import Path

import pytest
import rasterio

from fpts.domain.models import Location
from fpts.processing.phenology_service import PhenologyComputationService
from fpts.scripts import generate_seed_metrics, make_synthetic_ndvi_stack
from fpts.storage.local_raster_repository import LocalRasterRepository

# A coarser grid than compose (0.5 instead of 0.1 degrees) over the same area, to stay fast.
SEED_ARGS = [
    "--product",
    "ndvi_synth",
    "--year-from",
    "2016",
    "--year-to",
    "2026",
    "--lon-min",
    "-7.5",
    "--lon-max",
    "2.0",
    "--lat-min",
    "49.5",
    "--lat-max",
    "59.0",
    "--step-deg",
    "0.5",
]


def _doy(iso: str) -> int:
    return date.fromisoformat(iso).timetuple().tm_yday


@pytest.fixture(scope="module")
def seed_rows(tmp_path_factory) -> list[dict]:
    out = tmp_path_factory.mktemp("seed") / "seed.csv"
    assert generate_seed_metrics.main(["--out", str(out), *SEED_ARGS]) == 0
    with out.open(newline="") as f:
        return list(csv.DictReader(f))


def test_seed_is_deterministic_and_leaves_no_partial_file(tmp_path):
    a, b = tmp_path / "a.csv", tmp_path / "b.csv"
    generate_seed_metrics.main(["--out", str(a), *SEED_ARGS])
    generate_seed_metrics.main(["--out", str(b), *SEED_ARGS])

    assert a.read_bytes() == b.read_bytes()
    assert sorted(p.name for p in tmp_path.iterdir()) == ["a.csv", "b.csv"]


def test_seed_columns_and_ranges(seed_rows):
    assert list(seed_rows[0]) == [
        "product",
        "year",
        "lon",
        "lat",
        "sos_date",
        "eos_date",
        "season_length",
        "is_forest",
    ]
    assert len(seed_rows) == 20 * 20 * 11  # lon x lat points x years
    for row in seed_rows:
        sos, eos = _doy(row["sos_date"]), _doy(row["eos_date"])
        assert 40 <= sos <= 170
        assert 220 <= eos <= 345
        assert int(row["season_length"]) == eos - sos >= 60
        assert row["is_forest"] in {"true", "false"}


def test_seed_varies_in_space_and_time(seed_rows):
    lengths = [int(r["season_length"]) for r in seed_rows]
    assert max(lengths) - min(lengths) >= 60

    yearly_means = [
        statistics.mean(int(r["season_length"]) for r in seed_rows if int(r["year"]) == year)
        for year in range(2016, 2027)
    ]
    assert max(yearly_means) - min(yearly_means) >= 8

    north = [int(r["season_length"]) for r in seed_rows if float(r["lat"]) >= 57]
    south = [int(r["season_length"]) for r in seed_rows if float(r["lat"]) <= 51]
    assert statistics.mean(south) > statistics.mean(north) + 15


def test_seed_forest_is_a_minority_and_constant_across_years(seed_rows):
    by_point: dict[tuple[str, str], set[str]] = {}
    for r in seed_rows:
        by_point.setdefault((r["lon"], r["lat"]), set()).add(r["is_forest"])

    assert all(len(values) == 1 for values in by_point.values())
    forest_share = sum(values == {"true"} for values in by_point.values()) / len(by_point)
    assert 0.05 < forest_share < 0.4


def test_seed_drought_years_end_seasons_earlier_in_the_south_east(seed_rows):
    def eos(year: int, lon: str, lat: str) -> int:
        [row] = [
            r for r in seed_rows if int(r["year"]) == year and (r["lon"], r["lat"]) == (lon, lat)
        ]
        return _doy(row["eos_date"])

    south_east_drop = eos(2021, "1.0", "51.5") - eos(2022, "1.0", "51.5")
    north_west_drop = eos(2021, "-5.0", "57.5") - eos(2022, "-5.0", "57.5")
    assert south_east_drop > north_west_drop + 8


@pytest.fixture
def stack_dir(tmp_path, monkeypatch) -> Path:
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    make_synthetic_ndvi_stack.main()
    return tmp_path


def test_stack_has_23_composites_for_each_year(stack_dir):
    product_dir = stack_dir / "raw" / "ndvi_synth"
    assert sorted(int(d.name) for d in product_dir.iterdir() if d.is_dir()) == list(
        range(2016, 2027)
    )
    names = sorted(p.name for p in (product_dir / "2020").glob("doy_*.tif"))
    assert len(names) == 23
    assert (names[0], names[-1]) == ("doy_001.tif", "doy_353.tif")

    with rasterio.open(product_dir / "2020" / "doy_177.tif") as src:
        assert str(src.crs) == "EPSG:4326"
        assert tuple(src.bounds) == pytest.approx((-0.5, 51.4, -0.4, 51.5))
        summer = src.read(1)
    assert summer.min() >= 0.0 and summer.max() <= 1.0
    assert summer.max() - summer.min() > 0.01  # pixels differ


def test_stack_gives_a_plausible_season_that_differs_between_years(stack_dir):
    service = PhenologyComputationService(raster_repo=LocalRasterRepository(stack_dir))
    centre = Location(lat=51.455, lon=-0.445)

    curves = {
        year: service.compute_point_curve("ndvi_synth", year, centre) for year in (2018, 2021)
    }
    for curve in curves.values():
        assert 0.1 < min(curve.ndvi) < 0.3
        assert 0.6 < max(curve.ndvi) < 0.85
        assert 120 <= curve.season_length <= 220
    assert curves[2018].sos_date.timetuple().tm_yday != curves[2021].sos_date.timetuple().tm_yday


def test_stack_rerun_is_skipped_but_an_older_version_is_replaced(stack_dir):
    product_dir = stack_dir / "raw" / "ndvi_synth"
    composite = product_dir / "2020" / "doy_001.tif"
    written_at = composite.stat().st_mtime_ns

    make_synthetic_ndvi_stack.main()
    assert composite.stat().st_mtime_ns == written_at

    # Simulate a volume from the previous layout: old sentinel and an off-schedule composite.
    (product_dir / ".seeded").write_text("v1\n")
    stale = product_dir / "2020" / "doy_050.tif"
    stale.write_bytes(composite.read_bytes())

    make_synthetic_ndvi_stack.main()

    assert not stale.exists()
    assert (product_dir / ".seeded").read_text().strip() == make_synthetic_ndvi_stack.VERSION
