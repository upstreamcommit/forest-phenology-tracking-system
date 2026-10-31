# AGENTS.md

Guide for AI coding agents working in this repository. Humans: see `README.md`.

## What this is

Forest Phenology Tracking System (FPTS): a Python service that computes vegetation phenology
metrics (start/end of season, season length) from NDVI raster stacks and serves them for points,
multi-year timeseries and GeoJSON polygons. It is a personal project, maintained mostly by an AI
assistant on behalf of the owner.

Current state:
- The database is seeded with **synthetic** metrics (a 0.1 degree UK grid, 2016-2026).
- Compute mode reads a synthetic 10x10 NDVI stack in EPSG:4326.
- The MODIS ingestion CLI exists but is not connected to processing.
- The React frontend in `frontend/` is still the Vite starter.

## Commands

Run everything from the repository root.

| Task | Command |
|---|---|
| Install | `poetry install` |
| Unit tests | `poetry run pytest -q` (integration tests are deselected by `pytest.ini`) |
| Unit + integration (needs Docker) | `./precommit_tests.sh` (starts an isolated PostGIS test DB on port 55432, runs unit and integration tests, tears it down) |
| Lint | `poetry run ruff check src tests` |
| Format | `poetry run ruff format src tests` |
| Full stack | `docker compose up --build`, API on http://localhost:8000 (`/docs` for OpenAPI) |
| Stack smoke test | `./compose_smoke_test.sh` against the running stack (README examples and cache separation) |
| Stack teardown | `docker compose down --remove-orphans` (add `-v` only to wipe the DB and data volumes) |
| API without Docker | `PHENOLOGY_REPO_BACKEND=memory DATA_DIR=tests/fixtures poetry run uvicorn fpts.api.main:app --reload` |
| Frontend | `cd frontend && npm install && npm run dev` |

Integration tests read `FPTS_TEST_DATABASE_DSN` (for the test compose DB:
`postgresql://postgres:postgres@localhost:55432/fpts_test`) and skip when it is unset.
`./precommit_tests.sh` sets it for you. Always check the pytest summary: skipped integration tests
mean they did not run.

## Layout

- `src/fpts/api/` FastAPI app: `main.py` (`create_app`), `wiring.py` (builds services/caches), `routers/`, `schemas.py` (Pydantic).
- `src/fpts/config/settings.py` all configuration (`Settings`). `src/fpts/domain/` domain models and errors.
- `src/fpts/query/` read-side application service (`QueryService`) with caching.
- `src/fpts/processing/` raster loading and the phenology algorithm (`phenology_algorithm.py`). `processing/batch/` is a precompute CLI that is currently disabled (it exits before running).
- `src/fpts/storage/` repository interfaces plus PostGIS, in-memory and local-raster implementations.
- `src/fpts/sql/queries/` all runtime SQL; `src/fpts/sql/ddl/` the schema (applied by the PostGIS image's initdb).
- `src/fpts/cache/`, `src/fpts/utils/` caches, logging, request middleware, Prometheus metrics.
- `src/fpts/ingestion/` MODIS MOD13Q1 plan/fetch CLI (`python -m fpts.ingestion`).
- `src/fpts/scripts/` seed scripts used by docker compose, plus ad-hoc fixture generators.
- `tests/unit/` (no external services), `tests/integration/` (`@pytest.mark.integration`, real PostGIS), `tests/fixtures/` (small committed GeoTIFF stacks).

## Conventions

- Python 3.12, Poetry. Ruff with line length 100 and rules E, F, I. Code must pass `ruff check` and `ruff format --check`.
- Keep the layering: routers -> services -> repositories -> SQL. Routers do not touch repositories or SQL directly.
- All SQL lives in `src/fpts/sql/queries/`. Schema changes go in `src/fpts/sql/ddl/` and need a note in the PR (there is no migration tool yet). A new DDL file must also be added to `Dockerfile.postgis-test` and the CI `psql` step, and existing dev databases only pick it up after `docker compose down -v`.
- Domain models in `src/fpts/domain/` are frozen dataclasses; API shapes are Pydantic models in `schemas.py`.
- Configuration comes from `fpts.config.settings.Settings` (environment variables or `.env`). Add new settings there with a safe default.
- Every behaviour change needs a test. Unit tests must not need Docker; anything that needs PostGIS goes in `tests/integration/` with the `integration` marker.
- Tests assert correct behaviour. Never adjust a test to accommodate a bug; fix the bug or mark the test `xfail` with a reason.

## Git and pull requests

- Never commit directly to `main`. `main` is protected by a ruleset: force pushes and deletion are blocked.
- Branch from an up-to-date `main` using `fix/`, `feat/`, `chore/`, `docs/` or `refactor/` prefixes.
- One logical change per PR. Use Conventional Commits (`fix(api): ...`, `chore: ...`).
- Fill in `.github/pull_request_template.md`. List the test commands you ran and their results.
- Before opening a PR: `ruff check`, `ruff format --check` and the unit tests pass. Also run `./precommit_tests.sh` when touching SQL, storage, wiring or API behaviour.
- Call out breaking API, schema or config changes under "Behaviour change" in the PR.

## Work in progress

- An October 2026 code review catalogued defects with IDs such as `OPS-01`, `API-03` and `SCI-02`. The report is kept by the owner outside the repo; ask for it if you need a finding's details. Fixes land one PR per category; reference the IDs you address in commits and PR descriptions, and check open PRs first so work is not duplicated.
- The project is expected to evolve into a sensor-agnostic forest-condition service. The MODIS ingestion, phenology algorithm, raster repository, polygon area statistics and batch job are slated for replacement. Do not invest in patching them unless asked.

## Gotchas

- `fpts.api.main` builds an app at import time (`app = create_app()`), so importing it reads `Settings` from the environment and `.env`.
- Raster stacks are read from `{DATA_DIR}/raw/{product}/{year}/doy_NNN.tif` and are assumed to be EPSG:4326 with x = lon, y = lat.
- Repository point and timeseries lookups match lat/lon by exact float equality, so only exact seed-grid coordinates hit.
- `mode=repo` returns stored synthetic seed metrics; `mode=compute` computes from the raster stack. The synthetic stack covers none of the 0.1 degree seed-grid points, so no coordinate is answered by both. Use `lat=51.5&lon=-0.5` for repo and pixel centres such as `lat=51.495&lon=-0.495` (year 2020) for compute. Repo examples need the docker compose (PostGIS) stack: the memory backend starts with no stored metrics, so `mode=repo` always 404s there.
- Cache keys hold the exact inputs of the uncached lookup and are namespaced by source (`cache/keys.py`). Keep it that way: a cache hit must never change a response.

## Safety

- Never commit, print or log secrets. `.env` files are gitignored; use `.env.example` for documented defaults.
- Do not read `.env` files; ask the owner for the values you need.
- Ask before adding or upgrading dependencies, changing the database schema, or changing CI.
