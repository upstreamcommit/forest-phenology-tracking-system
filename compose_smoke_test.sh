#!/usr/bin/env bash
# Smoke-test a running docker compose stack with the README examples.
#
# Usage: docker compose up -d --build, wait until $BASE_URL/health answers, then run
#   ./compose_smoke_test.sh
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
failures=0

check() {
  local expected="$1" label="$2"
  shift 2
  local status
  status="$(curl -s -o /dev/null -w '%{http_code}' "$@")"
  if [ "$status" = "$expected" ]; then
    echo "ok   $status $label"
  else
    echo "FAIL $status (expected $expected) $label"
    failures=$((failures + 1))
  fi
}

P="$BASE_URL/phenology"

check 200 "health" "$BASE_URL/health"

# README examples
check 200 "point, repo" "$P/point?product=ndvi_synth&year=2020&lat=51.5&lon=-0.5&mode=repo"
check 200 "point, compute" "$P/point?product=ndvi_synth&year=2020&lat=51.495&lon=-0.495&mode=compute"
check 200 "timeseries" "$P/timeseries?product=ndvi_synth&lat=52.5&lon=-1.0&start_year=2018&end_year=2022"
check 200 "area" -X POST \
  "$P/area?year=2024&product=ndvi_synth&min_season_length=180&season_length_stat=mean" \
  -H "Content-Type: application/json" \
  -d '{"geometry":{"type":"Polygon","coordinates":[[[-1.5,52.0],[-0.5,52.0],[-0.5,53.0],[-1.5,53.0],[-1.5,52.0]]]}}'

# Raster-backed paths that need the data volume mounted correctly
check 200 "point, auto falls back to compute" \
  "$P/point?product=ndvi_synth&year=2020&lat=51.495&lon=-0.495&mode=auto"
check 200 "points, compute" -X POST "$P/points?year=2020&product=ndvi_synth" \
  -H "Content-Type: application/json" -d '{"locations":[{"lat":51.495,"lon":-0.495}]}'

# A stored row must not be served for a compute request (repo and compute caches are separate)
check 200 "point, repo on the seed grid" "$P/point?product=ndvi_synth&year=2020&lat=52.5&lon=-1.0&mode=repo"
check 422 "point, compute at the same coordinate is out of raster coverage" \
  "$P/point?product=ndvi_synth&year=2020&lat=52.5&lon=-1.0&mode=compute"
check 422 "point, repo rejects a custom threshold" \
  "$P/point?product=ndvi_synth&year=2020&lat=51.5&lon=-0.5&mode=repo&threshold_frac=0.3"

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "all checks passed"
