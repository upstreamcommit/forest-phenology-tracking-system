from fpts.cache.keys import compute_point_cache_key, repo_point_cache_key, timeseries_cache_key
from fpts.domain.models import Location

LOC = Location(lat=51.495, lon=-0.495)


def test_repo_and_compute_point_keys_never_collide():
    repo = repo_point_cache_key(product="p", year=2020, location=LOC)
    compute = compute_point_cache_key(product="p", year=2020, location=LOC, threshold_frac=0.5)

    assert repo != compute
    assert ":repo:" in repo
    assert ":compute:" in compute


def test_repo_point_key_format():
    # Stored metrics have no threshold, so the repo key is product, year and exact coordinates.
    key = repo_point_cache_key(product="p", year=2020, location=LOC)
    assert key == "phenology:point:repo:p:2020:51.495:-0.495"


def test_compute_point_key_keeps_the_exact_threshold():
    a = compute_point_cache_key(product="p", year=2020, location=LOC, threshold_frac=0.5)
    b = compute_point_cache_key(product="p", year=2020, location=LOC, threshold_frac=0.5004)
    assert a != b


def test_point_and_timeseries_keys_keep_exact_coordinates():
    near = Location(lat=51.4950001, lon=-0.495)

    assert repo_point_cache_key(product="p", year=2020, location=LOC) != repo_point_cache_key(
        product="p", year=2020, location=near
    )
    assert timeseries_cache_key(
        product="p", location=LOC, start_year=2018, end_year=2022
    ) != timeseries_cache_key(product="p", location=near, start_year=2018, end_year=2022)
