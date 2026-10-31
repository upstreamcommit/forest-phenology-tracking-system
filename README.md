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

- Language: Python (3.11+/3.12)
- Environment & Packaging: Poetry
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
- Node.js >= 28
- npm >= 11

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

Application Layer - QueryService orchestrates read operations

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
-   422 → Location outside the raster stack (`mode=compute`, or `mode=auto` without a stored row), a non-default `threshold_frac` with `mode=repo`, or invalid parameters

The two modes read different synthetic datasets:
- **Stored metrics (`mode=repo`)**: a grid every 0.1° from lon -7.5 to 2.0 and lat 49.5 to 59.0, years 2016-2026. Lookups need an exact grid coordinate, such as `lat=51.5&lon=-0.5`.
- **Raster stack (`mode=compute`)**: a 10x10 NDVI stack for 2020 only, covering lon -0.5 to -0.4 and lat 51.4 to 51.5 at 0.01°. Any point strictly inside a pixel works; pixel centres such as `lat=51.495&lon=-0.495` are safest. Points exactly on a pixel edge (multiples of 0.01°, such as `51.45,-0.45`) may currently be rejected as out of coverage.

Sample queries
```bash
curl "http://localhost:8000/phenology/point?product=ndvi_synth&year=2020&lat=51.5&lon=-0.5&mode=repo"
```
```bash
curl "http://localhost:8000/phenology/point?product=ndvi_synth&year=2020&lat=51.495&lon=-0.495&mode=compute"
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

## Getting started

Prerequisites
- Python 3.11+ (preferably 3.12).
- Poetry Installed.
- (Optional) Git & GitHub for version control.
- Docker
- Node.js >= 20
- npm >= 10

------------------------------------------------------------------------

## Run Locally

### Backend

This will allow a user to query the /phenoloyg/point, /phenoloyg/timeseries and /phenoloyg/area API endpoints.

a. Build and get API running (Only use -v tag if you want to clear the volume (databases and tables))
```bash
docker compose down -v --remove-orphans

docker compose up --build
```

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
npm install
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

Git hooks (lint on commit, full test suite on push):

- `poetry run pre-commit install --hook-type pre-commit --hook-type pre-push`
- Lint uses the ruff version pinned in `poetry.lock`, the same one CI runs.

------------------------------------------------------------------------

## Most recent phase of project

Production Hardening:

-   Docker + docker-compose (API + PostGIS)
-   GitHub Actions CI (lint + tests + coverage)
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
