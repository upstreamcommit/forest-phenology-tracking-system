#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker-compose.test.yml"

# Point the integration tests at the test database, and fail rather than skip them
# if the DSN is missing.
export FPTS_TEST_DATABASE_DSN="${FPTS_TEST_DATABASE_DSN:-postgresql://postgres:postgres@localhost:55432/fpts_test}"
export FPTS_REQUIRE_INTEGRATION=1

cleanup() {
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans || true
}
trap cleanup EXIT

# Fresh start
docker compose -f "$COMPOSE_FILE" down -v --remove-orphans
docker compose -f "$COMPOSE_FILE" up -d --build --force-recreate --wait

# Run unit and integration tests
poetry run pytest -m "integration or not integration"
