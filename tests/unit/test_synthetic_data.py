"""The synthetic seed CSV and NDVI stacks that docker compose generates.

They are demo data, but the UI and the README examples depend on their shape: plausible
ranges, real spatial and year-to-year variation, stored and computed seasons that agree where
they overlap, determinism, and safe reruns on existing data volumes.
"""

import csv
import statistics
from datetime import date
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from fpts.domain.models import Location
from fpts.processing.phenology_service import PhenologyComputationService
from fpts.scripts import generate_seed_metrics, make_synthetic_ndvi_stack
from fpts.scripts.synthetic_climate import is_forest, stable_u01
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
# The stored grid points inside the stack (lon -1.0..0.0, lat 51.0..52.0), exactly as compose
# generates them, so the agreement test sees the stored coordinates themselves.
OVERLAP = [
    (lat, lon)
    for lon, lat in generate_seed_metrics.generate_points(
        generate_seed_metrics.Bounds(-7.5, 2.0, 49.5, 59.0), 0.1
    )
    if -1.0 - 1e-9 <= lon <= 1e-9 and 51.0 - 1e-9 <= lat <= 52.0 + 1e-9
]


OVERLAP_POINTS_ALL = generate_seed_metrics.generate_points(
    generate_seed_metrics.Bounds(-7.5, 2.0, 49.5, 59.0), 0.1
)


def _doy(iso: str) -> int:
    return date.fromisoformat(iso).timetuple().tm_yday


@pytest.fixture(scope="module")
def seed_rows(tmp_path_factory) -> list[dict]:
    out = tmp_path_factory.mktemp("seed") / "seed.csv"
    assert generate_seed_metrics.main(["--out", str(out), *SEED_ARGS]) == 0
    with out.open(newline="") as f:
        return list(csv.DictReader(f))


@pytest.fixture(scope="module")
def stack_root(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("stack")
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("DATA_DIR", str(root))
        make_synthetic_ndvi_stack.main()
    return root


def test_noise_is_the_same_on_every_machine_and_run():
    # sha256-based, so unaffected by PYTHONHASHSEED; pinned so a change of hash is noticed.
    assert stable_u01("forest|51.50000|-0.50000") == 0.828303043593
    assert stable_u01("sos|2020|51.50000|-0.50000") == 0.067655698927


def test_seed_is_deterministic(tmp_path):
    a, b = tmp_path / "a.csv", tmp_path / "b.csv"
    generate_seed_metrics.main(["--out", str(a), *SEED_ARGS])
    generate_seed_metrics.main(["--out", str(b), *SEED_ARGS])

    assert a.read_bytes() == b.read_bytes()


def test_a_failed_seed_run_keeps_the_previous_csv_and_leaves_no_partial_file(tmp_path, monkeypatch):
    out = tmp_path / "seed.csv"
    out.write_text("previous\n")
    calls = 0

    def fail_midway(**kwargs):
        nonlocal calls
        calls += 1
        if calls > 10:
            raise RuntimeError("disk full")
        return date(2020, 4, 1), date(2020, 10, 1), 183

    monkeypatch.setattr(generate_seed_metrics, "phenology_dates", fail_midway)

    with pytest.raises(RuntimeError):
        generate_seed_metrics.main(["--out", str(out), *SEED_ARGS])

    assert out.read_text() == "previous\n"
    assert [p.name for p in tmp_path.iterdir()] == ["seed.csv"]


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


def test_stack_has_23_composites_a_year_on_a_grid_aligned_extent(stack_root):
    product_dir = stack_root / "raw" / "ndvi_synth"
    assert sorted(int(d.name) for d in product_dir.iterdir() if d.is_dir()) == list(
        range(2016, 2027)
    )
    names = sorted(p.name for p in (product_dir / "2020").glob("doy_*.tif"))
    assert len(names) == 23
    assert (names[0], names[-1]) == ("doy_001.tif", "doy_353.tif")

    with rasterio.open(product_dir / "2020" / "doy_177.tif") as src:
        assert str(src.crs) == "EPSG:4326"
        assert src.shape == (101, 101)
        assert tuple(src.bounds) == pytest.approx((-1.005, 50.995, 0.005, 52.005))
        summer = src.read(1)
    assert summer.min() >= 0.0 and summer.max() <= 1.0
    assert summer.max() - summer.min() > 0.05  # pixels differ


def test_stack_greens_up_earlier_in_an_early_spring(stack_root):
    def mean_ndvi(year: int, doy: int) -> float:
        path = stack_root / "raw" / "ndvi_synth" / str(year) / f"doy_{doy:03d}.tif"
        with rasterio.open(path) as src:
            return float(np.mean(src.read(1)))

    # 2025 has the earliest invented spring and 2021 the latest.
    assert mean_ndvi(2025, 97) > mean_ndvi(2021, 97) + 0.05


def test_stored_grid_has_no_negative_zero():
    lons = {lon for lon, _ in OVERLAP_POINTS_ALL}
    assert 0.0 in lons
    assert all(str(lon) != "-0.0" for lon in lons)


def test_stored_grid_points_inside_the_stack_have_a_matching_curve(stack_root):
    assert len(OVERLAP) == 121
    service = PhenologyComputationService(raster_repo=LocalRasterRepository(stack_root))

    for year in (2018, 2022):
        for lat, lon in OVERLAP:
            curve = service.compute_point_curve("ndvi_synth", year, Location(lat=lat, lon=lon))
            stored_sos, stored_eos, _ = generate_seed_metrics.phenology_dates(
                year=year, lat=lat, lon=lon, forest=is_forest(lat, lon)
            )
            # Computed dates land on 16-day composites, so allow one composite either way.
            assert abs((curve.sos_date - stored_sos).days) <= 16, (year, lat, lon)
            assert abs((curve.eos_date - stored_eos).days) <= 16, (year, lat, lon)


def _write_old_layout(product_dir: Path) -> None:
    """The layout origin/main's generator left: 2020 only, DOYs 1, 50, ..., 350, and its
    sentinel inside the year directory."""
    year_dir = product_dir / "2020"
    year_dir.mkdir(parents=True)
    for doy in (1, 50, 100, 150, 200, 250, 300, 350):
        make_synthetic_ndvi_stack.write_geotiff(
            year_dir / f"doy_{doy:03d}.tif",
            np.full((10, 10), 0.5, dtype=np.float32),
            from_origin(-0.5, 51.5, 0.01, 0.01),
        )
    (year_dir / ".seeded").write_text("ok\n")


EXPECTED = sorted(f"doy_{doy:03d}.tif" for doy in make_synthetic_ndvi_stack.DOYS)


def test_stack_replaces_the_previous_layout_on_an_existing_volume(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    product_dir = tmp_path / "raw" / "ndvi_synth"
    _write_old_layout(product_dir)

    make_synthetic_ndvi_stack.main(years=(2020, 2021))

    assert sorted(p.name for p in (product_dir / "2020").glob("doy_*.tif")) == EXPECTED
    with rasterio.open(product_dir / "2020" / "doy_001.tif") as src:
        assert src.shape == (101, 101)


def test_stack_from_an_older_version_is_rewritten(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    product_dir = tmp_path / "raw" / "ndvi_synth"
    make_synthetic_ndvi_stack.main(years=(2020,))
    composite = product_dir / "2020" / "doy_001.tif"
    written_at = composite.stat().st_mtime_ns
    # Same file names, but written by an earlier version of the generator.
    (product_dir / ".seeded").write_text("v2\n")

    make_synthetic_ndvi_stack.main(years=(2020,))

    assert composite.stat().st_mtime_ns != written_at
    assert (product_dir / ".seeded").read_text().strip() == make_synthetic_ndvi_stack.VERSION


def test_stack_rerun_is_skipped_until_its_files_change(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    product_dir = tmp_path / "raw" / "ndvi_synth"
    make_synthetic_ndvi_stack.main(years=(2020,))
    composite = product_dir / "2020" / "doy_001.tif"
    written_at = composite.stat().st_mtime_ns

    make_synthetic_ndvi_stack.main(years=(2020,))
    assert composite.stat().st_mtime_ns == written_at

    # An older generator run on this volume adds its own composites next to ours.
    stray = product_dir / "2020" / "doy_050.tif"
    stray.write_bytes(composite.read_bytes())

    make_synthetic_ndvi_stack.main(years=(2020,))

    assert not stray.exists()
    assert sorted(p.name for p in (product_dir / "2020").glob("doy_*.tif")) == EXPECTED
    assert (product_dir / ".seeded").read_text().strip() == make_synthetic_ndvi_stack.VERSION
