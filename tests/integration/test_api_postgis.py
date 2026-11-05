from datetime import date

import pytest
from fastapi.testclient import TestClient

from fpts.api.main import create_app
from fpts.config.settings import Settings
from fpts.domain.models import Location, PhenologyMetric


@pytest.mark.integration
def test_phenology_point_returns_seeded_metric_postgis(app_postgis):
    # Seed explicitly into PostGIS via the repo (same test shape as memory)
    repo = app_postgis.state.phenology_repo
    loc = Location(lat=52.5, lon=13.4)
    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=2020,
            location=loc,
            sos_date=date(2020, 4, 15),
            eos_date=date(2020, 10, 15),
            season_length=(date(2020, 10, 15) - date(2020, 4, 15)).days,
            is_forest=True,
        ),
    )

    client = TestClient(app_postgis)
    resp = client.get(
        "/phenology/point",
        params={
            "product": "test_product",
            "lat": 52.5,
            "lon": 13.4,
            "year": 2020,
        },
    )
    assert resp.status_code == 200


@pytest.mark.integration
def test_phenology_point_returns_404_for_missing_metric(
    app_postgis, product="test_product", lat=40.0, lon=10.0, year=2020, mode="repo"
):
    client = TestClient(app_postgis)

    resp = client.get(
        "/phenology/point",
        params={
            "product": product,
            "lat": lat,
            "lon": lon,
            "year": year,
            "mode": mode,
        },
    )

    assert resp.status_code == 404
    detail = resp.json()["detail"]
    assert isinstance(detail, str)
    assert detail == (
        f"No phenology data found for product: {product}, "
        f"location: lat={lat}, lon={lon} and year: {year}"
    )


@pytest.mark.integration
def test_postgis_repo_timeseries_returns_sorted_rows(app_postgis):
    repo = app_postgis.state.phenology_repo
    loc = Location(lat=52.5, lon=13.4)

    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=2021,
            location=loc,
            sos_date=date(2021, 4, 20),
            eos_date=date(2021, 10, 20),
            season_length=(date(2021, 10, 20) - date(2021, 4, 20)).days,
            is_forest=True,
        ),
    )
    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=2019,
            location=loc,
            sos_date=date(2019, 4, 10),
            eos_date=date(2019, 10, 10),
            season_length=(date(2019, 10, 10) - date(2019, 4, 10)).days,
            is_forest=True,
        ),
    )

    qs = app_postgis.state.query_service
    out = qs.get_point_timeseries(
        product="test_product", location=loc, start_year=2018, end_year=2022
    )
    assert [metric.year for metric in out] == [2019, 2021]


@pytest.mark.integration
def test_phenology_timeseries_returns_seeded_metrics_postgis(app_postgis):
    repo = app_postgis.state.phenology_repo
    loc = Location(lat=52.5, lon=13.4)

    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=2021,
            location=loc,
            sos_date=date(2021, 4, 20),
            eos_date=date(2021, 10, 20),
            season_length=(date(2021, 10, 20) - date(2021, 4, 20)).days,
            is_forest=True,
        ),
    )
    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=2019,
            location=loc,
            sos_date=date(2019, 4, 10),
            eos_date=date(2019, 10, 10),
            season_length=(date(2019, 10, 10) - date(2019, 4, 10)).days,
            is_forest=True,
        ),
    )

    client = TestClient(app_postgis)
    resp = client.get(
        "/phenology/timeseries",
        params={
            "product": "test_product",
            "lat": 52.5,
            "lon": 13.4,
            "start_year": 2018,
            "end_year": 2022,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["product"] == "test_product"
    assert body["location"] == {"lat": 52.5, "lon": 13.4}
    assert body["start_year"] == 2018
    assert body["end_year"] == 2022
    assert [m["year"] for m in body["metrics"]] == [2019, 2021]


@pytest.mark.integration
def test_phenology_timeseries_returns_404_when_empty(
    app_postgis,
    product="test_product",
    lat=52.5,
    lon=13.4,
    start_year=2018,
    end_year=2022,
):
    client = TestClient(app_postgis)

    resp = client.get(
        "/phenology/timeseries",
        params={
            "product": product,
            "lat": lat,
            "lon": lon,
            "start_year": start_year,
            "end_year": end_year,
        },
    )

    assert resp.status_code == 404
    detail = resp.json()["detail"]
    assert isinstance(detail, str)
    assert detail == (
        f"No phenology data found for product: {product}, "
        f"location: lat={lat}, lon={lon} and year range: {start_year}-{end_year}"
    )


@pytest.mark.integration
def test_phenology_area_returns_aggregates_for_intersecting_points(app_postgis):
    repo = app_postgis.state.phenology_repo

    # Three points in 2020, only two inside our polygon
    p1 = Location(lat=52.50, lon=13.40)  # inside
    p2 = Location(lat=52.51, lon=13.41)  # inside
    p3 = Location(lat=52.60, lon=13.60)  # outside

    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=2020,
            location=p1,
            sos_date=date(2020, 4, 10),
            eos_date=date(2020, 10, 10),
            season_length=183,
            is_forest=True,
        ),
    )
    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=2020,
            location=p2,
            sos_date=date(2020, 4, 20),
            eos_date=date(2020, 10, 20),
            season_length=184,
            is_forest=False,
        ),
    )
    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=2020,
            location=p3,
            sos_date=date(2020, 4, 1),
            eos_date=date(2020, 10, 1),
            season_length=183,
            is_forest=True,
        ),
    )

    # Small polygon around p1 & p2 (lon,lat order in GeoJSON)
    poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [13.39, 52.49],
                [13.42, 52.49],
                [13.42, 52.52],
                [13.39, 52.52],
                [13.39, 52.49],
            ]
        ],
    }

    client = TestClient(app_postgis)
    resp = client.post(
        "/phenology/area",
        params={"product": "test_product", "year": 2020},
        json={"geometry": poly},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["product"] == "test_product"
    assert body["year"] == 2020
    assert body["n"] == 2
    assert abs(body["mean_season_length"] - ((183 + 184) / 2)) < 1e-9
    assert abs(body["forest_fraction"] - 0.5) < 1e-9


@pytest.mark.integration
def test_phenology_area_returns_404_when_no_matches(app_postgis, product="test_product", year=2020):
    poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [0.0, 0.0],
                [0.1, 0.0],
                [0.1, 0.1],
                [0.0, 0.1],
                [0.0, 0.0],
            ]
        ],
    }

    client = TestClient(app_postgis)
    resp = client.post(
        "/phenology/area",
        params={"product": product, "year": year},
        json={"geometry": poly},
    )

    assert resp.status_code == 404
    detail = resp.json()["detail"]
    assert isinstance(detail, str)
    assert detail == (
        f"No phenology data found intersecting this polygon for product: {product} and year: {year}"
    )


@pytest.mark.integration
def test_area_returns_400_for_invalid_geometry(app_postgis):
    client = TestClient(app_postgis)

    invalid_poly = {"type": "Polygon", "coordinates": []}  # invalid ring

    resp = client.post(
        "/phenology/area",
        params={"product": "test_product", "year": 2020},
        json={"geometry": invalid_poly},
    )

    assert resp.status_code == 400


@pytest.mark.integration
def test_phenology_area_only_forest_filters_rows(app_postgis):
    repo = app_postgis.state.phenology_repo
    year = 2020

    inside_forest = Location(lat=52.50, lon=13.40)
    inside_nonforest = Location(lat=52.51, lon=13.41)

    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=year,
            location=inside_forest,
            sos_date=date(year, 4, 10),
            eos_date=date(year, 10, 10),
            season_length=100,
            is_forest=True,
        ),
    )
    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=year,
            location=inside_nonforest,
            sos_date=date(year, 4, 10),
            eos_date=date(year, 10, 10),
            season_length=200,
            is_forest=False,
        ),
    )

    poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [13.39, 52.49],
                [13.42, 52.49],
                [13.42, 52.52],
                [13.39, 52.52],
                [13.39, 52.49],
            ]
        ],
    }

    client = TestClient(app_postgis)
    resp = client.post(
        "/phenology/area",
        params={"product": "test_product", "year": year, "only_forest": True},
        json={"geometry": poly},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["n"] == 1
    assert abs(body["mean_season_length"] - 100.0) < 1e-9
    assert abs(body["forest_fraction"] - 1.0) < 1e-9


@pytest.mark.integration
def test_phenology_area_min_season_length_filters_rows(app_postgis):
    repo = app_postgis.state.phenology_repo
    year = 2020

    p1 = Location(lat=52.50, lon=13.40)  # 100
    p2 = Location(lat=52.51, lon=13.41)  # 200

    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=year,
            location=p1,
            sos_date=date(year, 4, 10),
            eos_date=date(year, 10, 10),
            season_length=100,
            is_forest=True,
        ),
    )
    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=year,
            location=p2,
            sos_date=date(year, 4, 10),
            eos_date=date(year, 10, 10),
            season_length=200,
            is_forest=True,
        ),
    )

    poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [13.39, 52.49],
                [13.42, 52.49],
                [13.42, 52.52],
                [13.39, 52.52],
                [13.39, 52.49],
            ]
        ],
    }

    client = TestClient(app_postgis)
    resp = client.post(
        "/phenology/area",
        params={"product": "test_product", "year": year, "min_season_length": 150},
        json={"geometry": poly},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["n"] == 1
    assert abs(body["mean_season_length"] - 200.0) < 1e-9
    assert abs(body["forest_fraction"] - 1.0) < 1e-9


@pytest.mark.integration
def test_phenology_area_median_season_length(app_postgis):
    repo = app_postgis.state.phenology_repo
    year = 2020

    p1 = Location(lat=52.50, lon=13.40)
    p2 = Location(lat=52.51, lon=13.41)
    p3 = Location(lat=52.505, lon=13.405)

    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=year,
            location=p1,
            sos_date=date(year, 4, 1),
            eos_date=date(year, 10, 1),
            season_length=10,
            is_forest=True,
        ),
    )
    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=year,
            location=p2,
            sos_date=date(year, 4, 1),
            eos_date=date(year, 10, 1),
            season_length=20,
            is_forest=True,
        ),
    )
    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=year,
            location=p3,
            sos_date=date(year, 4, 1),
            eos_date=date(year, 10, 1),
            season_length=30,
            is_forest=True,
        ),
    )

    poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [13.39, 52.49],
                [13.42, 52.49],
                [13.42, 52.52],
                [13.39, 52.52],
                [13.39, 52.49],
            ]
        ],
    }

    client = TestClient(app_postgis)
    resp = client.post(
        "/phenology/area",
        params={
            "product": "test_product",
            "year": year,
            "season_length_stat": "median",
        },
        json={"geometry": poly},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["n"] == 3
    assert body["median_season_length"] == 20.0
    assert body["mean_season_length"] is None


@pytest.mark.integration
def test_phenology_area_both_mean_and_median(app_postgis):
    repo = app_postgis.state.phenology_repo
    year = 2020

    p1 = Location(lat=52.50, lon=13.40)
    p2 = Location(lat=52.51, lon=13.41)
    p3 = Location(lat=52.505, lon=13.405)

    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=year,
            location=p1,
            sos_date=date(year, 4, 1),
            eos_date=date(year, 10, 1),
            season_length=10,
            is_forest=True,
        ),
    )
    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=year,
            location=p2,
            sos_date=date(year, 4, 1),
            eos_date=date(year, 10, 1),
            season_length=20,
            is_forest=True,
        ),
    )
    repo.upsert(
        product="test_product",
        metric=PhenologyMetric(
            year=year,
            location=p3,
            sos_date=date(year, 4, 1),
            eos_date=date(year, 10, 1),
            season_length=30,
            is_forest=True,
        ),
    )

    client = TestClient(app_postgis)

    poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [13.39, 52.49],
                [13.42, 52.49],
                [13.42, 52.52],
                [13.39, 52.52],
                [13.39, 52.49],
            ]
        ],
    }

    resp = client.post(
        "/phenology/area",
        params={"product": "test_product", "year": year, "season_length_stat": "both"},
        json={"geometry": poly},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["mean_season_length"] is not None
    assert body["median_season_length"] is not None


@pytest.mark.integration
def test_phenology_timeseries_returns_400_when_year_range_invalid(app_postgis):
    client = TestClient(app_postgis)
    resp = client.get(
        "/phenology/timeseries",
        params={
            "product": "test_product",
            "lat": 52.5,
            "lon": 13.4,
            "start_year": 2022,
            "end_year": 2020,
        },
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid parameters: end_year must be >= start_year"


@pytest.mark.integration
def test_phenology_area_rejects_invalid_season_length_stat(app_postgis):
    client = TestClient(app_postgis)

    poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [13.39, 52.49],
                [13.42, 52.49],
                [13.42, 52.52],
                [13.39, 52.52],
                [13.39, 52.49],
            ]
        ],
    }

    resp = client.post(
        "/phenology/area",
        params={"product": "test_product", "year": 2020, "season_length_stat": "avg"},
        json={"geometry": poly},
    )
    assert resp.status_code == 422


def _grid_metric(year: int, lat: float, lon: float, season_length: int = 180) -> PhenologyMetric:
    return PhenologyMetric(
        year=year,
        location=Location(lat=lat, lon=lon),
        sos_date=date(year, 4, 1),
        eos_date=date.fromordinal(date(year, 4, 1).toordinal() + season_length),
        season_length=season_length,
        is_forest=lat > 52,
    )


@pytest.mark.integration
def test_phenology_grid_filters_orders_and_maps_rows_postgis(app_postgis):
    repo = app_postgis.state.phenology_repo
    # Seed-style coordinates: rounded to 6 decimals after float accumulation.
    lons = [round(-0.6 + 0.1 * i, 6) for i in range(4)]
    lats = [round(51.9 + 0.1 * i, 6) for i in range(3)]  # 51.9, 52.0, 52.1
    repo.upsert_many(
        product="test_product",
        metrics=[
            _grid_metric(2020, lat, lon, season_length=150 + 10 * i)
            for i, (lat, lon) in enumerate((lat, lon) for lat in lats for lon in lons)
        ]
        + [_grid_metric(2021, lats[0], lons[0])],
    )
    # Another product at the same places must not leak into the answer.
    repo.upsert_many(
        product="other_product", metrics=[_grid_metric(2020, lats[0], lon, 99) for lon in lons]
    )
    client = TestClient(app_postgis)

    everything = client.get("/phenology/grid", params={"product": "test_product", "year": 2020})
    assert everything.status_code == 200
    features = everything.json()["features"]
    assert [f["geometry"]["coordinates"] for f in features] == [
        [lon, lat] for lat in lats for lon in lons
    ]
    assert [f["properties"]["season_length"] for f in features] == [150 + 10 * i for i in range(12)]
    assert features[0]["properties"] == {
        "sos_date": "2020-04-01",
        "eos_date": "2020-08-29",
        "season_length": 150,
        "is_forest": False,
    }
    assert features[-1]["properties"] == {
        "sos_date": "2020-04-01",
        "eos_date": "2020-12-17",
        "season_length": 260,
        "is_forest": True,
    }

    # Inclusive edges, on exact stored values.
    box = f"{lons[1]},{lats[1]},{lons[2]},{lats[2]}"
    inside = client.get(
        "/phenology/grid", params={"product": "test_product", "year": 2020, "bbox": box}
    )
    assert [f["geometry"]["coordinates"] for f in inside.json()["features"]] == [
        [lons[1], lats[1]],
        [lons[2], lats[1]],
        [lons[1], lats[2]],
        [lons[2], lats[2]],
    ]


@pytest.mark.integration
def test_phenology_grid_coordinates_round_trip_bit_for_bit_postgis(app_postgis):
    awkward = Location(lat=51.123456789012, lon=-0.30000000000000004)
    app_postgis.state.phenology_repo.upsert(
        product="test_product", metric=_grid_metric(2020, awkward.lat, awkward.lon)
    )
    client = TestClient(app_postgis)

    [feature] = client.get(
        "/phenology/grid", params={"product": "test_product", "year": 2020}
    ).json()["features"]
    lon, lat = feature["geometry"]["coordinates"]

    assert (lon, lat) == (awkward.lon, awkward.lat)
    params = {"product": "test_product", "lat": lat, "lon": lon}
    assert client.get("/phenology/point", params={**params, "year": 2020}).status_code == 200
    assert (
        client.get(
            "/phenology/timeseries", params={**params, "start_year": 2020, "end_year": 2020}
        ).status_code
        == 200
    )


@pytest.mark.integration
def test_phenology_grid_rejects_more_points_than_the_limit_postgis(postgis_dsn):
    app = create_app(
        settings=Settings(
            phenology_repo_backend="postgis", database_dsn=postgis_dsn, grid_max_features=2
        )
    )
    app.state.phenology_repo.upsert_many(
        product="test_product",
        metrics=[_grid_metric(2020, 51.5, lon) for lon in (-0.3, -0.2, -0.1)],
    )
    client = TestClient(app)

    resp = client.get("/phenology/grid", params={"product": "test_product", "year": 2020})
    assert resp.status_code == 422
    [error] = resp.json()["detail"]
    assert (error["type"], error["ctx"]) == ("too_many_features", {"limit": 2})

    two = client.get(
        "/phenology/grid",
        params={"product": "test_product", "year": 2020, "bbox": "-0.3,51.5,-0.2,51.5"},
    )
    assert len(two.json()["features"]) == 2


@pytest.mark.integration
def test_catalog_reports_stored_coverage_per_product_postgis(app_postgis):
    repo = app_postgis.state.phenology_repo
    lons = [round(-7.5 + 0.1 * i, 6) for i in range(5)]
    for year in (2016, 2017):
        repo.upsert_many(
            product="test_product",
            metrics=[_grid_metric(year, lat, lon) for lat in (49.5, 49.6) for lon in lons],
        )
    # One longitude only, and longitudes that differ only by float noise: no step for either,
    # and neither may borrow another product's step.
    repo.upsert_many(
        product="one_lon", metrics=[_grid_metric(2020, lat, 3.0) for lat in (10.0, 10.5)]
    )
    repo.upsert_many(
        product="noisy",
        metrics=[_grid_metric(2020, 10.0, 0.3), _grid_metric(2020, 10.1, 0.30000000000000004)],
    )

    resp = TestClient(app_postgis).get("/catalog")

    assert resp.status_code == 200
    products = {p["id"]: p for p in resp.json()["products"]}
    product = products["test_product"]
    assert product["stored"]["years"] == [2016, 2017]
    assert product["stored"]["bbox"] == [lons[0], 49.5, lons[-1], 49.6]
    assert product["stored"]["grid_step_deg"] == pytest.approx(0.1)
    assert product["synthetic"] is None
    assert products["one_lon"]["stored"]["grid_step_deg"] is None
    assert products["noisy"]["stored"]["grid_step_deg"] is None
