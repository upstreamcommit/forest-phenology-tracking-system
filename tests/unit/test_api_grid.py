"""GET /phenology/grid on the memory backend: GeoJSON shape, filtering, bbox validation, limit."""

from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from fpts.api.main import create_app
from fpts.config.settings import Settings
from fpts.domain.models import Location, PhenologyMetric

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def _metric(year: int, lat: float, lon: float, season_length: int = 180) -> PhenologyMetric:
    return PhenologyMetric(
        year=year,
        location=Location(lat=lat, lon=lon),
        sos_date=date(year, 4, 1),
        eos_date=date(year, 4, 1) + timedelta(days=season_length),
        season_length=season_length,
        is_forest=lat > 52,
    )


def _app(**settings):
    app = create_app(Settings(phenology_repo_backend="memory", data_dir=str(FIXTURES), **settings))
    repo = app.state.phenology_repo
    for lat, lon in [(52.1, -0.5), (51.5, -0.5), (51.5, -0.6), (51.5, 0.3)]:
        repo.add_metric("ndvi_synth", _metric(2020, lat, lon))
    repo.add_metric("ndvi_synth", _metric(2020, 52.1, 0.3, season_length=200))
    repo.add_metric("ndvi_synth", _metric(2021, 51.5, -0.5, season_length=170))
    repo.add_metric("other", _metric(2020, 51.5, -0.5, season_length=99))
    return app


def _coords(resp) -> list[list[float]]:
    return [f["geometry"]["coordinates"] for f in resp.json()["features"]]


def test_returns_a_feature_collection_of_one_product_and_year_in_lat_lon_order():
    resp = TestClient(_app()).get("/phenology/grid", params={"year": 2020})

    assert resp.status_code == 200
    body = resp.json()
    assert body["type"] == "FeatureCollection"
    assert (body["product"], body["year"], body["requested_bbox"]) == ("ndvi_synth", 2020, None)
    # Lat first: (51.5, 0.3) comes before (52.1, -0.5), which lon-first ordering would swap.
    assert _coords(resp) == [[-0.6, 51.5], [-0.5, 51.5], [0.3, 51.5], [-0.5, 52.1], [0.3, 52.1]]
    assert body["features"][0]["type"] == "Feature"
    assert body["features"][0]["geometry"]["type"] == "Point"
    assert body["features"][0]["properties"] == {
        "sos_date": "2020-04-01",
        "eos_date": "2020-09-28",
        "season_length": 180,
        "is_forest": False,
    }
    assert body["features"][-1]["properties"] == {
        "sos_date": "2020-04-01",
        "eos_date": "2020-10-18",
        "season_length": 200,
        "is_forest": True,
    }


def test_coordinates_are_returned_bit_for_bit_and_round_trip_to_repo_lookups():
    app = _app()
    awkward = Location(lat=51.123456789012, lon=-0.30000000000000004)
    app.state.phenology_repo.add_metric("ndvi_synth", _metric(2020, awkward.lat, awkward.lon))
    client = TestClient(app)

    features = client.get(
        "/phenology/grid", params={"year": 2020, "bbox": "-0.31,51.1,-0.29,51.2"}
    ).json()["features"]

    [feature] = features
    lon, lat = feature["geometry"]["coordinates"]
    assert (lon, lat) == (awkward.lon, awkward.lat)
    point = client.get("/phenology/point", params={"lat": lat, "lon": lon, "year": 2020})
    assert point.status_code == 200
    series = client.get(
        "/phenology/timeseries",
        params={"lat": lat, "lon": lon, "start_year": 2020, "end_year": 2020},
    )
    assert series.status_code == 200


def test_bbox_filters_with_inclusive_edges():
    resp = TestClient(_app()).get(
        "/phenology/grid", params={"year": 2020, "bbox": "-0.6,51.5,-0.5,52.1"}
    )

    assert resp.status_code == 200
    assert resp.json()["requested_bbox"] == [-0.6, 51.5, -0.5, 52.1]
    assert _coords(resp) == [[-0.6, 51.5], [-0.5, 51.5], [-0.5, 52.1]]


def test_an_area_or_product_without_points_is_an_empty_collection():
    client = TestClient(_app())

    assert client.get("/phenology/grid", params={"year": 2019}).json()["features"] == []
    assert (
        client.get("/phenology/grid", params={"year": 2020, "product": "none"}).json()["features"]
        == []
    )


@pytest.mark.parametrize(
    "bbox",
    [
        "1,2,3",  # three numbers
        "1,2,3,4,5",  # five numbers
        "a,51,0,52",  # not a number
        "",  # empty
        "1,51,-1,52",  # crosses the antimeridian (min_lon > max_lon)
        "0,53,1,52",  # min_lat > max_lat
        "0,51,181,52",  # out of range
        "nan,51,0,52",  # not finite
        "inf,51,0,52",  # not finite
    ],
)
def test_invalid_bbox_is_a_422_on_the_bbox_parameter(bbox):
    resp = TestClient(_app()).get("/phenology/grid", params={"year": 2020, "bbox": bbox})

    assert resp.status_code == 422
    [error] = resp.json()["detail"]
    assert error["type"] == "value_error"
    assert error["loc"] == ["query", "bbox"]
    assert error["input"] == bbox


def test_more_points_than_the_limit_is_its_own_422():
    client = TestClient(_app(grid_max_features=4))

    too_many = client.get("/phenology/grid", params={"year": 2020})
    assert too_many.status_code == 422
    [error] = too_many.json()["detail"]
    assert error["type"] == "too_many_features"
    assert error["loc"] == ["query", "bbox"]
    assert error["ctx"] == {"limit": 4}
    assert error["input"] is None  # no bbox was sent

    one_over = client.get("/phenology/grid", params={"year": 2020, "bbox": "-0.6,51.5,0.3,52.1"})
    assert one_over.status_code == 422  # 5 points

    exactly_the_limit = client.get(
        "/phenology/grid", params={"year": 2020, "bbox": "-0.5,51.5,0.3,52.1"}
    )
    assert exactly_the_limit.status_code == 200
    assert len(exactly_the_limit.json()["features"]) == 4


def test_the_limit_must_be_positive():
    with pytest.raises(ValidationError):
        Settings(grid_max_features=0)


def test_large_responses_are_gzipped_for_clients_that_accept_it():
    app = _app()
    repo = app.state.phenology_repo
    for i in range(50):
        repo.add_metric("ndvi_synth", _metric(2020, 55.0, round(-5.0 + 0.1 * i, 6)))
    client = TestClient(app)

    resp = client.get("/phenology/grid", params={"year": 2020}, headers={"Accept-Encoding": "gzip"})

    assert resp.headers["content-encoding"] == "gzip"
    assert len(resp.json()["features"]) == 55  # httpx decodes it transparently

    small = client.get("/health", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in small.headers  # under the 1 KB minimum
    assert "x-request-id" in small.headers
    raw = client.get(
        "/phenology/grid", params={"year": 2020}, headers={"Accept-Encoding": "identity"}
    )
    assert "content-encoding" not in raw.headers
