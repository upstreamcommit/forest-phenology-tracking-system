"""How mode=repo, mode=compute and mode=auto interact, including through the shared caches.

Uses the memory backend with the tests/fixtures ndvi_synth 2020 stack, where computing the
pixel centre (51.495, -0.495) gives SOS 2020-05-29, EOS 2020-09-06, season length 100.
"""

from datetime import date

from fastapi.testclient import TestClient

from fpts.domain.models import Location, PhenologyMetric

POINT = {"product": "ndvi_synth", "year": 2020, "lat": 51.495, "lon": -0.495}
COMPUTED_SEASON_LENGTH = 100

# A stored row that is deliberately different from what compute returns for the same point.
STORED = PhenologyMetric(
    year=2020,
    location=Location(lat=51.495, lon=-0.495),
    sos_date=date(2020, 3, 1),
    eos_date=date(2020, 11, 30),
    season_length=274,
    is_forest=False,
)


def _get(client: TestClient, **params):
    return client.get("/phenology/point", params={**POINT, **params})


def test_repo_miss_is_not_answered_from_the_compute_cache(app_memory):
    client = TestClient(app_memory)

    assert _get(client, mode="repo").status_code == 404
    assert _get(client, mode="compute").status_code == 200
    # Before the fix the computed metric was served here as if it were stored.
    assert _get(client, mode="repo").status_code == 404


def test_compute_is_not_answered_from_the_repo_cache(app_memory):
    app_memory.state.phenology_repo.add_metric(product="ndvi_synth", metric=STORED)
    client = TestClient(app_memory)

    repo = _get(client, mode="repo")
    assert repo.status_code == 200
    assert repo.json()["season_length"] == STORED.season_length

    compute = _get(client, mode="compute")
    assert compute.status_code == 200
    assert compute.json()["season_length"] == COMPUTED_SEASON_LENGTH
    assert compute.json()["sos_date"] == "2020-05-29"


def test_auto_prefers_the_stored_row(app_memory):
    app_memory.state.phenology_repo.add_metric(product="ndvi_synth", metric=STORED)
    client = TestClient(app_memory)

    resp = _get(client, mode="auto")
    assert resp.status_code == 200
    assert resp.json()["season_length"] == STORED.season_length


# threshold_frac=0.2 -> 0.1 + 0.2 * 0.6 = 0.22, first/last value >= 0.22 at DOY 150 and 300.
# It must differ from the default's answer, or a dropped threshold would go unnoticed.
CUSTOM_THRESHOLD = 0.2
CUSTOM_SEASON_LENGTH = 150
CUSTOM_EOS = "2020-10-26"


def test_auto_with_a_custom_threshold_computes_directly(app_memory):
    app_memory.state.phenology_repo.add_metric(product="ndvi_synth", metric=STORED)
    client = TestClient(app_memory)

    resp = _get(client, mode="auto", threshold_frac=CUSTOM_THRESHOLD)
    assert resp.status_code == 200
    assert resp.json()["season_length"] == CUSTOM_SEASON_LENGTH
    assert resp.json()["eos_date"] == CUSTOM_EOS


def test_compute_caches_each_threshold_separately(app_memory):
    client = TestClient(app_memory)

    default = _get(client, mode="compute")
    custom = _get(client, mode="compute", threshold_frac=CUSTOM_THRESHOLD)
    default_again = _get(client, mode="compute")

    assert default.json()["season_length"] == COMPUTED_SEASON_LENGTH
    assert custom.json()["season_length"] == CUSTOM_SEASON_LENGTH
    assert default_again.json()["season_length"] == COMPUTED_SEASON_LENGTH


def test_repo_rejects_a_custom_threshold(app_memory):
    app_memory.state.phenology_repo.add_metric(product="ndvi_synth", metric=STORED)
    client = TestClient(app_memory)

    resp = _get(client, mode="repo", threshold_frac=CUSTOM_THRESHOLD)
    assert resp.status_code == 422
    # Same shape as FastAPI's own validation errors (documented in OpenAPI as HTTPValidationError)
    [error] = resp.json()["detail"]
    assert error["loc"] == ["query", "threshold_frac"]
    assert "threshold_frac only applies when computing" in error["msg"]


def test_repo_accepts_the_default_threshold_explicitly(app_memory):
    app_memory.state.phenology_repo.add_metric(product="ndvi_synth", metric=STORED)
    client = TestClient(app_memory)

    resp = _get(client, mode="repo", threshold_frac=0.5)
    assert resp.status_code == 200
    assert resp.json()["season_length"] == STORED.season_length


def test_points_returns_404_when_no_raster_stack_exists(app_memory):
    client = TestClient(app_memory)

    resp = client.post(
        "/phenology/points",
        params={"year": 2020, "product": "no_such_product"},
        json={"locations": [{"lat": 51.495, "lon": -0.495}]},
    )
    assert resp.status_code == 404
    assert "No NDVI stack files found" in resp.json()["detail"]
