"""GET /phenology/point/ndvi against the tests/fixtures ndvi_synth 2020 stack (memory backend).

The fixture stack is uniform: DOYs 1, 50, ..., 350 with NDVI 0.10 ... 0.70 at every pixel, so at
the default threshold (0.1 + 0.5 * 0.6 = 0.4) the season runs from DOY 150 to DOY 250.
"""

import pytest
from fastapi.testclient import TestClient

PARAMS = {"product": "ndvi_synth", "year": 2020, "lat": 51.495, "lon": -0.495}


def test_returns_the_series_threshold_and_season(app_memory):
    resp = TestClient(app_memory).get("/phenology/point/ndvi", params=PARAMS)

    assert resp.status_code == 200
    body = resp.json()
    assert body["location"] == {"lat": 51.495, "lon": -0.495}
    assert [o["doy"] for o in body["observations"]] == [1, 50, 100, 150, 200, 250, 300, 350]
    assert body["observations"][1]["date"] == "2020-02-19"
    # Rounded to 6 decimals, so float32 noise (0.699999988...) never reaches clients.
    assert body["observations"][4]["ndvi"] == 0.7
    assert body["threshold_frac"] == 0.5
    assert body["threshold_ndvi"] == 0.4
    assert (body["sos_date"], body["eos_date"], body["season_length"]) == (
        "2020-05-29",
        "2020-09-06",
        100,
    )


def test_reports_the_centre_of_the_pixel_it_sampled(app_memory):
    resp = TestClient(app_memory).get(
        "/phenology/point/ndvi", params={**PARAMS, "lat": 51.4932, "lon": -0.4968}
    )

    assert resp.status_code == 200
    assert resp.json()["location"] == {"lat": 51.4932, "lon": -0.4968}
    assert resp.json()["pixel"] == {"lat": pytest.approx(51.495), "lon": pytest.approx(-0.495)}


@pytest.mark.parametrize("threshold_frac", [0.5, 0.2])
def test_agrees_with_point_compute_mode(app_memory, threshold_frac):
    client = TestClient(app_memory)
    params = {**PARAMS, "threshold_frac": threshold_frac}

    curve = client.get("/phenology/point/ndvi", params=params).json()
    point = client.get("/phenology/point", params={**params, "mode": "compute"}).json()

    for field in ("sos_date", "eos_date", "season_length"):
        assert curve[field] == point[field]


def test_custom_threshold_moves_the_threshold_and_season(app_memory):
    resp = TestClient(app_memory).get(
        "/phenology/point/ndvi", params={**PARAMS, "threshold_frac": 0.2}
    )

    body = resp.json()
    assert body["threshold_ndvi"] == pytest.approx(0.22)
    assert body["season_length"] == 150


def test_outside_the_stack_is_the_out_of_coverage_422(app_memory):
    resp = TestClient(app_memory).get(
        "/phenology/point/ndvi", params={**PARAMS, "lat": 52.5, "lon": -1.0}
    )

    assert resp.status_code == 422
    assert resp.json()["error"] == "out_of_coverage"


def test_a_year_without_a_stack_is_404(app_memory):
    resp = TestClient(app_memory).get("/phenology/point/ndvi", params={**PARAMS, "year": 2019})

    assert resp.status_code == 404
    assert "No NDVI stack files found" in resp.json()["detail"]


@pytest.mark.parametrize("threshold_frac", [0, 1, -0.1])
def test_threshold_outside_the_open_interval_is_rejected(app_memory, threshold_frac):
    resp = TestClient(app_memory).get(
        "/phenology/point/ndvi", params={**PARAMS, "threshold_frac": threshold_frac}
    )

    assert resp.status_code == 422
