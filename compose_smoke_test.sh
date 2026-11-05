#!/usr/bin/env bash
# Smoke-test a running docker compose stack with the README examples.
#
# Usage: docker compose up -d --build, then
#   ./compose_smoke_test.sh
# It first polls $BASE_URL/health (60 attempts, 2s apart, 5s timeout each). After the HTTP checks
# it fails if the $API_CONTAINER log shows a server exception during the run, since a correct
# status code can still hide one.
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
BASE_URL="${BASE_URL%/}"
API_CONTAINER="${API_CONTAINER:-fpts-api}"
failures=0
log_file="$(mktemp)"
trap 'rm -f "$log_file"' EXIT

# Server-log check: the API container's id, and how many of its log lines predate this run (a
# line count rather than a timestamp, so host/VM clock skew can't hide errors). Empty until found.
container_id=""
log_start=""

# Saves the API container's whole log (uvicorn writes to stderr) to $log_file.
read_api_log() {
  docker logs "$API_CONTAINER" >"$log_file" 2>&1
}

# Prints the API container's id; fails if docker or the container is missing.
api_container_id() {
  command -v docker >/dev/null 2>&1 \
    && docker container inspect --format '{{.Id}}' "$API_CONTAINER" 2>/dev/null
}

# Looks up the API container. With "count", lines already in its log are skipped later;
# otherwise the whole log belongs to this run.
find_api_container() {
  if ! container_id="$(api_container_id)"; then
    container_id=""
    return 0
  fi
  log_start=0
  if [ "$1" = count ] && read_api_log; then
    log_start="$(wc -l <"$log_file" | tr -d ' ')"
  fi
}

find_api_container count

for i in $(seq 1 60); do
  curl -fs -o /dev/null --max-time 5 "$BASE_URL/health" 2>/dev/null && break
  if [ "$i" = 60 ]; then
    echo "API not ready at $BASE_URL/health"
    exit 1
  fi
  sleep 2
done

# A container created or replaced while we waited for /health (say, by a `docker compose up`
# still in progress) holds only this run's log lines.
if [ -z "$container_id" ] || [ "$(api_container_id)" != "$container_id" ]; then
  find_api_container all
fi

check() {
  local expected="$1" label="$2"
  shift 2
  local status
  status="$(curl -s -o /dev/null --max-time 30 -w '%{http_code}' "$@")"
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
check 200 "point, compute" "$P/point?product=ndvi_synth&year=2020&lat=51.47&lon=-0.43&mode=compute"
check 200 "timeseries" "$P/timeseries?product=ndvi_synth&lat=52.5&lon=-1.0&start_year=2018&end_year=2022"
check 200 "area" -X POST \
  "$P/area?year=2024&product=ndvi_synth&min_season_length=180&season_length_stat=mean" \
  -H "Content-Type: application/json" \
  -d '{"geometry":{"type":"Polygon","coordinates":[[[-1.5,52.0],[-0.5,52.0],[-0.5,53.0],[-1.5,53.0],[-1.5,52.0]]]}}'
check 200 "grid" "$P/grid?product=ndvi_synth&year=2022&bbox=-0.6,51.4,-0.4,51.6"
check 200 "point ndvi curve" "$P/point/ndvi?product=ndvi_synth&year=2021&lat=51.5&lon=-0.5"
check 200 "catalog" "$BASE_URL/catalog"

# Stored grid points inside the raster stack (lon -1.0..0.0, lat 51.0..52.0) have both sources.
check 200 "point, compute at a stored grid point" \
  "$P/point?product=ndvi_synth&year=2020&lat=51.5&lon=-0.5&mode=compute"
check 200 "point, compute at the stack's south-west grid point (fails on a stale data volume)" \
  "$P/point?product=ndvi_synth&year=2020&lat=51.0&lon=-1.0&mode=compute"
check 422 "grid, bbox crossing the antimeridian" \
  "$P/grid?product=ndvi_synth&year=2022&bbox=179,51,-179,52"
check 404 "point ndvi, year without a raster stack" \
  "$P/point/ndvi?product=ndvi_synth&year=2015&lat=51.5&lon=-0.5"

# Raster-backed paths that need the data volume mounted correctly
check 200 "point, auto falls back to compute" \
  "$P/point?product=ndvi_synth&year=2020&lat=51.47&lon=-0.43&mode=auto"
check 200 "points, compute" -X POST "$P/points?year=2020&product=ndvi_synth" \
  -H "Content-Type: application/json" -d '{"locations":[{"lat":51.47,"lon":-0.43}]}'

# Repo and compute results are cached separately, so neither mode may answer for the other.
# The compute cache is warm for this off-grid pixel centre after the checks above.
check 404 "point, repo is not answered from the compute cache" \
  "$P/point?product=ndvi_synth&year=2020&lat=51.47&lon=-0.43&mode=repo"
check 200 "point, repo on the seed grid" "$P/point?product=ndvi_synth&year=2020&lat=52.5&lon=-1.0&mode=repo"
check 422 "point, compute is not answered from the repo cache (out of raster coverage)" \
  "$P/point?product=ndvi_synth&year=2020&lat=52.5&lon=-1.0&mode=compute"
check 422 "point, repo rejects a custom threshold" \
  "$P/point?product=ndvi_synth&year=2020&lat=51.5&lon=-0.5&mode=repo&threshold_frac=0.3"

# Server exceptions logged during the run, for example after a handler has already responded.
if [ -n "$container_id" ]; then
  sleep 1 # let log lines from the last requests arrive
  if [ "$(api_container_id)" != "$container_id" ]; then
    echo "FAIL $API_CONTAINER was removed or replaced during the run, so its log can't be checked"
    failures=$((failures + 1))
  elif ! read_api_log; then
    echo "FAIL could not read the $API_CONTAINER log"
    failures=$((failures + 1))
  elif [ "$(wc -l <"$log_file" | tr -d ' ')" -lt "$log_start" ]; then
    echo "FAIL the $API_CONTAINER log shrank during the run (rotated?), so it can't be checked"
    failures=$((failures + 1))
  else
    errors="$(tail -n +"$((log_start + 1))" "$log_file" \
      | grep -E 'Exception in ASGI application|Traceback \(most recent call last\)')"
    if [ -n "$errors" ]; then
      echo "FAIL $API_CONTAINER logged server exceptions:"
      echo "$errors"
      failures=$((failures + 1))
    else
      echo "ok   no server exceptions in the $API_CONTAINER log"
    fi
  fi
else
  echo "SKIP no $API_CONTAINER container found, so its log was not checked"
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
if [ -n "$container_id" ]; then
  echo "all checks passed"
else
  echo "all HTTP checks passed (server log not checked)"
fi
