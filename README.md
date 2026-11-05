# Forest Phenology Tracking System (FPTS)

A Python system for computing **forest phenology metrics** (start/end of growing season, season length) from raster NDVI time series, designed with production-grade architecture and testability in mind.

Forest phenology metrics (e.g. green-up, senescence) are often computed in notebooks or ad-hoc scripts. This project explores how such computations can be modeled, tested, and exposed as a maintainable software system.

This project is designed as a **software engineering portfolio project** at the intersection of:
- geospatial data
- environmental science
- backend system design

------------------------------------------------------------------------

## Overview

The Forest Phenology Tracking System (FPTS) is a backend analytics
platform designed to compute and serve vegetation phenology metrics
(e.g., season length, SOS/EOS dates) at both point and polygon levels.

The system demonstrates: - Clean architecture separation (API → Service
→ Repository → SQL) - PostGIS-powered spatial querying -
Production-grade HTTP semantics (400 vs 404 correctness) - Integration
testing with real PostGIS - Query parameter validation and schema
contracts

------------------------------------------------------------------------

## Tech Stack

Backend

- Language: Python 3.12
- Environment & Packaging: Poetry 2
- Web Framework: FastAPI
- ASGI Server: Uvicorn
- Configuration: pydantic-settings
- Data Modeling:
        - Python dataclasses for domain models
        - Pydantic models for API schemas
- Database: Postgres + PostGIS for phenology metrics
- Logging: Standard library logging with centralized setup


Frontend
## Frontend Development

Prerequisites:
- Node.js 22.13+ or 24+ (the `engines` range in `frontend/package.json`)
- npm >= 10

------------------------------------------------------------------------

## Backend Architecture

```
src/fpts/
├── api/ (FastAPI routers + schemas)
├── query/ (Application services)
├── storage/ (Repository interfaces + PostGIS implementation)
├── sql/queries/ (Runtime SQL)
├── config/ (Settings & configuration)
```

### Backend Layers

API Layer - Request validation - Response schemas - HTTP error mapping

Application Layer - QueryService orchestrates read operations, and CatalogService reports which products, years and extents exist

Storage Layer - PhenologyRepository (abstract) -
PostGISPhenologyRepository (default production backend)

SQL Layer - All runtime SQL centralized in sql/queries/phenology.py

------------------------------------------------------------------------

## Implemented Endpoints

### 1. GET /phenology/point

Returns phenology metrics for a single location and year.

Parameters:
- lat
- lon
- mode: `repo` (stored metrics, default), `compute` (calculated from the NDVI raster stack) or `auto` (stored first, then compute)
- year
- product
- threshold_frac (optional, default 0.5): fraction of the seasonal amplitude used for SOS/EOS when computing. Stored metrics only exist for the default, so another value is rejected with `mode=repo` and makes `mode=auto` skip stored metrics and compute directly.

Behaviour:
-   200 → Data found
-   404 → No data for that location/year
-   422 → Location outside the raster stack when computing (`mode=compute`, or `mode=auto` with no stored row or a non-default `threshold_frac`), a non-default `threshold_frac` with `mode=repo`, or invalid parameters

The two modes read different synthetic datasets (`GET /catalog` reports both):
- **Stored metrics (`mode=repo`)**: a grid every 0.1° from lon -7.5 to 2.0 and lat 49.5 to 59.0, years 2016-2026. Lookups need an exact grid coordinate, such as `lat=51.5&lon=-0.5`; `/phenology/grid` returns them exactly as stored.
- **Raster stack (`mode=compute`)**: a 101x101 NDVI stack per year for 2016-2026, 23 composites every 16 days, with pixel centres on every 0.01° from lon -1.0 to 0.0 and lat 51.0 to 52.0. Any point within half a pixel of a centre works, including the outer edges.

The 121 stored grid points inside that square (such as `lat=51.5&lon=-0.5`) are also pixel
centres, so they have both stored metrics and a computed season and NDVI curve; `mode=auto`
returns the stored row there. Elsewhere only one source answers: `lat=52.5&lon=-1.0` is
stored only, and off-grid pixel centres such as `lat=51.47&lon=-0.43` are computed only.

Both datasets are invented, not observations, but come from one seasonal model so maps and
charts show something and the two roughly agree: seasons start later and end earlier further
north and on invented uplands, woodland sits in patchy clusters, springs drift slightly earlier
each year, and some years have early or late springs or summer droughts that hit the south-east
hardest (for example 2018 and 2022). Computed start and end dates land on composite days, so
they differ from the stored dates at the same point by up to about one composite (16 days).

Sample queries
```bash
curl "http://localhost:8000/phenology/point?product=ndvi_synth&year=2020&lat=51.5&lon=-0.5&mode=repo"
```
```bash
curl "http://localhost:8000/phenology/point?product=ndvi_synth&year=2020&lat=51.47&lon=-0.43&mode=compute"
```

------------------------------------------------------------------------

### 2. GET /phenology/timeseries

Returns multi-year phenology metrics for a single location.

Parameters:
- lat
- lon
- start_year
- end_year
- product

Behavior:
- 400 → Invalid year range
- 404 → No data found

Sample query
```bash
curl "http://localhost:8000/phenology/timeseries?product=ndvi_synth&lat=52.5&lon=-1.0&start_year=2018&end_year=2022"
```

------------------------------------------------------------------------

### 3. POST /phenology/area

Aggregates phenology metrics within a GeoJSON polygon for a given year.

Features: - Accepts Polygon or MultiPolygon - Geometry validation via
PostGIS (ST_IsValid, ST_IsEmpty) - Boundary-inclusive selection via
ST_Covers - Optional filters: - only_forest - min_season_length -
Supports statistics: - mean - median (via percentile_cont) - both

Parameters:
- geometry
- season_length_stat
- min_season_length
- year
- product

Behavior:
- 400 → Invalid geometry
- 404 → Valid geometry but no intersecting data
- 200 → Aggregated results

Sample query

```bash
curl "http://localhost:8000/phenology/area?year=2024&product=ndvi_synth&min_season_length=180&season_length_stat=mean" -H "Content-Type: application/json" -d '{"geometry":{"type":"Polygon","coordinates":[[[-1.5,52.0],[-0.5,52.0],[-0.5,53.0],[-1.5,53.0],[-1.5,52.0]]]}}' 
```

------------------------------------------------------------------------

### 4. GET /phenology/grid

Returns the stored metrics of every grid point for one product and year as a GeoJSON
FeatureCollection of points, ordered by lat then lon, for drawing a map in one request. Point
coordinates are exactly as stored, so they can be passed back to `/phenology/point`
(`mode=repo`) and `/phenology/timeseries` unchanged.

Parameters:
- year
- product
- bbox (optional): `min_lon,min_lat,max_lon,max_lat` in degrees, edges inclusive. It may not cross the antimeridian. Omit it for every stored point.

Behavior:
- 200 → FeatureCollection, empty when no stored points match
- 422 → Invalid bbox (`type: value_error`), or more than `GRID_MAX_FEATURES` points (`type: too_many_features`, with `ctx.limit`; default 50,000, while the full seed grid is 9,216 per year). Both have `loc` `["query", "bbox"]`.

Sample query
```bash
curl "http://localhost:8000/phenology/grid?product=ndvi_synth&year=2022&bbox=-0.6,51.4,-0.4,51.6"
```

------------------------------------------------------------------------

### 5. GET /phenology/point/ndvi

Returns the NDVI series at the raster pixel nearest a point, with the threshold and the SOS/EOS
that `mode=compute` derives from it, for drawing the phenology curve.

Parameters:
- lat
- lon
- year
- product
- threshold_frac (optional, default 0.5)

Behavior:
- 200 → `observations` (doy, date, ndvi), the sampled `pixel` centre, `threshold_ndvi`, and `sos_date`, `eos_date`, `season_length`
- 404 → No raster stack for that product and year
- 422 → Location outside the raster stack (same body as `/phenology/point`), or invalid parameters

Sample query
```bash
curl "http://localhost:8000/phenology/point/ndvi?product=ndvi_synth&year=2021&lat=51.5&lon=-0.5"
```

------------------------------------------------------------------------

### 6. GET /catalog

Lists the products the API can answer for: whether each is synthetic, and the years and extent
of stored metrics (with the grid step) and of NDVI stacks that metrics can be computed from.
Clients should read this instead of hard-coding product names, years or extents. Cached for a
minute.

Sample query
```bash
curl "http://localhost:8000/catalog"
```

------------------------------------------------------------------------

## Getting started

Prerequisites
- Python 3.12.
- Poetry 2 (CI and the Docker image use 2.5.1).
- (Optional) Git & GitHub for version control.
- Docker
- Node.js 22.13+ or 24+
- npm >= 10

------------------------------------------------------------------------

## Run Locally

### Backend

This will allow a user to query the /phenology/point, /phenology/points, /phenology/timeseries, /phenology/area, /phenology/grid, /phenology/point/ndvi and /catalog API endpoints.

a. Build and get API running (Only use -v tag if you want to clear the volume (databases and tables))
```bash
docker compose down -v --remove-orphans

docker compose up --build
```

The database runs Postgres 18 (PostGIS 3.6). A `db_data` volume created by an older Postgres
major won't start with it: wipe it once with `docker compose down -v`. The `postgis/postgis`
images are amd64-only, so the database runs under emulation on arm64: Docker Desktop and
Rancher Desktop on Apple Silicon provide it, while a plain Docker Engine on arm64 Linux needs
amd64 emulation registered first (`docker run --privileged --rm tonistiigi/binfmt --install amd64`).

The seed CSV is only generated when the data volume lacks one, so after the synthetic data
changes (as in November 2026) run `docker compose down -v` once to pick up the new data.

b. Tear down
run `ctrl + c` to stop the container
Then the following for clean up:
``` bash
docker compose down -v --remove-orphans
```

### Other relevant/ useful commands

- Smoke-test the running stack with the sample queries above (Run in another terminal tab)
```bash
./compose_smoke_test.sh
```

- Check tables present in Docker container (Run in another terminal tab)
```bash
docker exec -it fpts-postgis psql -U postgres -d fpts -c "\dt"
```

### Frontend

## Frontend Development

cd frontend
npm ci
npm run dev

------------------------------------------------------------------------

## Testing Strategy

-   Unit tests for service layer
-   Integration tests with real PostGIS
-   Synthetic spatial geometries seeded per test
-   Validation of:
    -   Mean/median correctness
    -   Filter behavior
    -   400 vs 404 behavior
    -   Enum validation (422)

Run tests:

- (UNIT): `poetry run pytest -q`
- (UNIT + INTEGRATION, one command): `./precommit_tests.sh`
    - Starts the test database, runs every test and tears the database down again.
    - The test stack uses its own compose project (`fpts-test`), so it never touches the dev stack.
- (INTEGRATION ONLY, step by step):
    - For all integration tests, execute the following commands in order:
    - Start the test database:
        - `docker compose -f docker-compose.test.yml down -v --remove-orphans`
        - `docker compose -f docker-compose.test.yml up -d --build --force-recreate --wait`
    - Point the tests at it (without this, integration tests are skipped):
        - `export FPTS_TEST_DATABASE_DSN=postgresql://postgres:postgres@localhost:55432/fpts_test`
        - Optionally `export FPTS_REQUIRE_INTEGRATION=1` to make a missing DSN fail instead of skip.
    - (OPTIONAL) Verify schema exists
        -  `docker compose -f docker-compose.test.yml exec -T postgis_test psql -U postgres -d fpts_test -c "\dt public.*"`
    - Run integration tests ONLY:
        - `poetry run pytest -m integration`
    - (OPTIONAL) Run BOTH integration and unit tests:
        - `poetry run pytest -m "integration or not integration"`
    - Tear down
        - `docker compose -f docker-compose.test.yml down -v --remove-orphans`

- Coverage: `./precommit_tests.sh` measures it over unit + integration tests and fails below the
  floor, as CI does. By hand, with the test database up:
  `FPTS_TEST_DATABASE_DSN=postgresql://postgres:postgres@localhost:55432/fpts_test FPTS_REQUIRE_INTEGRATION=1 poetry run pytest -m "integration or not integration" --cov`
  (without the DSN the integration tests skip and the unit-only figure fails the floor). The scope
  (all of `src/fpts` except the disabled batch job) and the `fail_under` floor are in
  `pyproject.toml`.

Git hooks (lint on commit, full test suite on push):

- `poetry run pre-commit install --hook-type pre-commit --hook-type pre-push`
- Lint uses the ruff version pinned in `poetry.lock`, the same one CI runs.

CI (`.github/workflows/ci.yml`) runs on pull requests, on pushes to `main` and on demand from the
Actions tab, in three jobs:

- **python**: `poetry check --lock`, ruff, then unit and integration tests together with coverage
  against the Postgres 18 / PostGIS 3.6 test database from `docker-compose.test.yml` (the same one
  `./precommit_tests.sh` uses).
- **stack**: builds every image, starts `docker compose`, and runs `./compose_smoke_test.sh`,
  which must end with `all checks passed` (so the API log was checked for server exceptions).
- **frontend**: `npm ci`, `npm run lint` and `npm run build` in `frontend/` on Node 24.

------------------------------------------------------------------------

## Most recent phase of project

Production Hardening:

-   Docker + docker-compose (API + PostGIS)
-   GitHub Actions CI (lint, unit + integration tests with coverage, compose stack smoke test,
    frontend build)
-   Structured logging
-   Request logging middleware
-   Optional Prometheus metrics endpoint
-   Basic caching strategy
-   Seed data so that point, timeseries and area queries can be made by users on app startup

------------------------------------------------------------------------

## Future Polish

-   Architecture diagram
-   Engineering decisions document
-   Scaling discussion (tiling, batch jobs, async workers)
-   Optional minimal demo client (Notebook or small UI)
-   Deployment example (e.g., Fly.io / Render / AWS ECS)

------------------------------------------------------------------------

## Long-Term Extensions

-   Raster ingestion pipeline
-   Background workers for batch processing
-   Precomputed spatial tiles
-   GeoJSON FeatureCollection outputs
-   Time-series trend analysis (slope detection)
-   Vectorized polygon performance optimization

------------------------------------------------------------------------

## License

MIT
