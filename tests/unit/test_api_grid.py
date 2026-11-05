"""GET /phenology/grid on the memory backend: GeoJSON shape, filtering, bbox validation, limit."""

from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

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
    for lat, lon in [(52.1, -0.5), (51.5, -0.5), (51.5, -0.6), (52.1, 0.3)]:
        repo.add_metric("ndvi_synth", _metric(2020, lat, lon))
    repo.add_metric("ndvi_synth", _metric(2021, 51.5, -0.5, season_length=170))
    repo.add_metric("other", _metric(2020, 51.5, -0.5))
    return app


def test_returns_a_feature_collection_of_one_product_and_year_in_lat_lon_order():
    resp = TestClient(_app()).get("/phenology/grid", params={"year": 2020})

    assert resp.status_code == 200
    body = resp.json()
    assert body["type"] == "FeatureCollection"
    assert (body["product"], body["year"], body["requested_bbox"]) == ("ndvi_synth", 2020, None)
    assert [f["geometry"]["coordinates"] for f in body["features"]] == [
        [-0.6, 51.5],
        [-0.5, 51.5],
        [-0.5, 52.1],
        [0.3, 52.1],
    ]
    first = body["features"][0]
    assert first["type"] == "Feature"
    assert first["geometry"]["type"] == "Point"
    assert first["properties"] == {
        "sos_date": "2020-04-01",
        "eos_date": "2020-09-28",
        "season_length": 180,
        "is_forest": False,
    }


def test_coordinates_round_trip_to_a_repo_point_lookup():
    client = TestClient(_app())
    feature = client.get("/phenology/grid", params={"year": 2020}).json()["features"][2]
    lon, lat = feature["geometry"]["coordinates"]

    point = client.get("/phenology/point", params={"lat": lat, "lon": lon, "year": 2020})

    assert point.status_code == 200
    assert point.json()["season_length"] == feature["properties"]["season_length"]


def test_bbox_filters_with_inclusive_edges():
    resp = TestClient(_app()).get(
        "/phenology/grid", params={"year": 2020, "bbox": "-0.6,51.5,-0.5,52.1"}
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["requested_bbox"] == [-0.6, 51.5, -0.5, 52.1]
    assert [f["geometry"]["coordinates"] for f in body["features"]] == [
        [-0.6, 51.5],
        [-0.5, 51.5],
        [-0.5, 52.1],
    ]


def test_an_area_without_points_is_an_empty_collection():
    resp = TestClient(_app()).get("/phenology/grid", params={"year": 2019})

    assert resp.status_code == 200
    assert resp.json()["features"] == []


@pytest.mark.parametrize(
    "bbox",
    [
        "1,2,3",  # three numbers
        "a,51,0,52",  # not a number
        "1,51,-1,52",  # crosses the antimeridian (min_lon > max_lon)
        "0,53,1,52",  # min_lat > max_lat
        "0,51,181,52",  # out of range
        "nan,51,0,52",  # not finite
    ],
)
def test_invalid_bbox_is_a_422_on_the_bbox_parameter(bbox):
    resp = TestClient(_app()).get("/phenology/grid", params={"year": 2020, "bbox": bbox})

    assert resp.status_code == 422
    [error] = resp.json()["detail"]
    assert error["loc"] == ["query", "bbox"]
    assert error["input"] == bbox


def test_more_points_than_the_limit_is_a_422_asking_for_a_smaller_bbox():
    client = TestClient(_app(grid_max_features=3))

    too_many = client.get("/phenology/grid", params={"year": 2020})
    assert too_many.status_code == 422
    [error] = too_many.json()["detail"]
    assert error["loc"] == ["query", "bbox"]
    assert "more than 3 points" in error["msg"]

    exactly_the_limit = client.get(
        "/phenology/grid", params={"year": 2020, "bbox": "-0.6,51.5,-0.5,52.1"}
    )
    assert exactly_the_limit.status_code == 200
    assert len(exactly_the_limit.json()["features"]) == 3
