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
- mode
- year
- product

Behaviour:
-   200 → Data found
-   404 → No data for that location/year

Sample query
```bash
curl "http://localhost:8000/phenology/point?product=ndvi_synth&year=2020&lat=51.495&lon=-0.495&mode=repo"
```
If the above query returns no data found, try it with compute mode:
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
- (INTEGRATION ONLY):
    - For all integration tests, execute the following commands in order:
    - Start the test database:
        - `docker compose -f docker-compose.test.yml down -v --remove-orphans`
        - `docker compose -f docker-compose.test.yml up -d --build --force-recreate`
    - (OPTIONAL) Verify schema exists
        -  `docker compose -f docker-compose.test.yml exec -T postgis_test psql -U postgres -d fpts_test -c "\dt public.*"`
    - Run integration tests ONLY:
        - `poetry run pytest -m integration`
    - (OPTIONAL) Run BOTH integration and unit tests:
        - `poetry run pytest -m "integration or not integration"`
    - Tear down
        - `docker compose -f docker-compose.test.yml down -v --remove-orphans`

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
