#!/usr/bin/env bash
# Smoke-test a running docker compose stack with the README examples, and the frontend on $WEB_URL.
#
# Usage: docker compose up -d --build, then
#   ./compose_smoke_test.sh
# It first polls $BASE_URL/health (60 attempts, 2s apart, 5s timeout each). After the HTTP checks
# it fails if the $API_CONTAINER log shows a server exception during the run, since a correct
# status code can still hide one.
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
BASE_URL="${BASE_URL%/}"
WEB_URL="${WEB_URL:-http://localhost:8080}"
WEB_URL="${WEB_URL%/}"
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

# The frontend through nginx: the app itself, an SPA route, and the API through its proxy.
check_body() {
  local expected="$1" label="$2" url="$3"
  if curl -fs --max-time 30 "$url" | grep -q "$expected"; then
    echo "ok   200 $label"
  else
    echo "FAIL $label (no \"$expected\" in $url)"
    failures=$((failures + 1))
  fi
}

# Checks the status and response headers of a GET that accepts gzip. Each "Name: value" argument
# after the URL must be that header's only value; "Name: " means the header must be absent.
check_headers() {
  local expected_status="$1" label="$2" url="$3"
  shift 3
  local headers status expected name value actual shown bad=""
  headers="$(curl -s -o /dev/null -D - --max-time 30 -H 'Accept-Encoding: gzip' "$url" \
    | tr -d '\r')"
  status="$(printf '%s\n' "$headers" | awk 'NR == 1 { print $2 }')"
  [ "$status" = "$expected_status" ] || bad="status ${status:-none} (expected $expected_status)"
  for expected in "$@"; do
    name="${expected%%:*}"
    value="${expected#*: }"
    actual="$(printf '%s\n' "$headers" | awk -v name="$name" '
      index(tolower($0), tolower(name) ":") == 1 { sub(/^[^:]*:[ \t]*/, ""); print }')"
    if [ "$actual" != "$value" ]; then
      shown="'${value:-absent}'"
      [ "$value" = "$WEB_CSP" ] && shown="the policy pinned in WEB_CSP"
      bad="${bad:+$bad; }$name is '${actual:-absent}' (expected $shown)"
    fi
  done
  if [ -z "$bad" ]; then
    echo "ok   $status $label"
  else
    echo "FAIL $label: $bad"
    failures=$((failures + 1))
  fi
}

# The policy in frontend/security-headers.conf, which nginx and `vite preview` send. Pinned here
# so that a change to it is deliberate: the map needs connect-src for OpenFreeMap, and the app
# runs no inline script.
WEB_CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';"
WEB_CSP+=" img-src 'self' data: blob: https://tiles.openfreemap.org;"
WEB_CSP+=" connect-src 'self' https://tiles.openfreemap.org; worker-src 'self' blob:;"
WEB_CSP+=" font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
WEB_SECURITY=(
  "Content-Security-Policy: $WEB_CSP"
  "X-Content-Type-Options: nosniff"
  "Referrer-Policy: strict-origin-when-cross-origin"
)
WEB_IMMUTABLE="Cache-Control: public, max-age=31536000, immutable"

# The frontend runs only with `--profile web`; REQUIRE_WEB=1 (set in CI) makes it mandatory.
# Without it the checks are skipped only when nothing answers: an error status is a failure.
web_status="$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "$WEB_URL/" 2>/dev/null)"
if [ "${REQUIRE_WEB:-0}" = 1 ] || [ "${web_status:-000}" != 000 ]; then
  check_body "Forest Phenology Explorer" "web, app page" "$WEB_URL/"
  check_body "Forest Phenology Explorer" "web, app route served as the app" \
    "$WEB_URL/point/51.5/-0.5?year=2021"
  check_body '"default_threshold_frac"' "web, API through the proxy" "$WEB_URL/catalog"
  check_headers 200 "web, app page headers (CSP, never cached, no server version)" "$WEB_URL/" \
    "${WEB_SECURITY[@]}" "Cache-Control: no-cache" "Server: nginx"
  check_headers 200 "web, app route headers" "$WEB_URL/point/51.5/-0.5" \
    "${WEB_SECURITY[@]}" "Cache-Control: no-cache"
  # Error pages keep the security headers but are never cached as immutable.
  check_headers 404 "web, missing asset headers" "$WEB_URL/assets/smoke-test-missing.js" \
    "${WEB_SECURITY[@]}" "Cache-Control: "
  # The API's redirects keep the port the browser used.
  check_headers 307 "web, API redirect through the proxy keeps the port" "$WEB_URL/catalog/" \
    "Location: $WEB_URL/catalog"

  # script-src 'self' blocks inline scripts, so index.html may only load scripts by src.
  # Newlines are joined first, so a <script> tag split across lines is still seen.
  index_html="$(curl -fs --max-time 30 "$WEB_URL/")"
  scripts="$(printf '%s\n' "$index_html" | tr '\n' ' ' | grep -oiE '<script[^>]*>')"
  inline="$(printf '%s\n' "$scripts" | grep -viE '[[:space:]]src=')"
  if [ -z "$scripts" ]; then
    echo "FAIL web, no <script src> found in index.html (is the app being served?)"
    failures=$((failures + 1))
  elif [ -n "$inline" ]; then
    echo "FAIL web, index.html has an inline script, which the CSP blocks: $inline"
    failures=$((failures + 1))
  else
    echo "ok   200 web, index.html has no inline script"
  fi

  # Browsers refuse module workers without a JavaScript MIME type, and the map stays blank.
  # The worker is referenced from the lazily loaded map chunk, two hops from index.html.
  js_files="$(printf '%s\n' "$index_html" | grep -oE 'assets/[A-Za-z0-9_.-]+\.js' | sort -u)"
  chunks="$(for js in $js_files; do curl -fs --max-time 30 "$WEB_URL/$js"; done \
    | grep -oE 'assets/[A-Za-z0-9_.-]+\.js' | sort -u)"
  worker="$(for js in $js_files $chunks; do curl -fs --max-time 30 "$WEB_URL/$js"; done \
    | grep -oE 'maplibre-gl-worker-[A-Za-z0-9_-]{8}\.mjs' | head -n 1)"
  worker_type="$(curl -fsI --max-time 30 "$WEB_URL/assets/$worker" 2>/dev/null \
    | tr -d '\r' | awk -F': ' 'tolower($1) == "content-type" { print $2 }')"
  if [ -n "$worker" ] && [[ "$worker_type" == *javascript* ]]; then
    echo "ok   200 web, map worker served as JavaScript"
  else
    echo "FAIL web, map worker ${worker:-not found} served as '${worker_type:-nothing}'"
    failures=$((failures + 1))
  fi
  # Fingerprinted, so cached for good; gzipped, so caches must keep the encodings apart.
  js_file="$(printf '%s\n' "$js_files" | head -n 1)"
  check_headers 200 "web, script asset headers" "$WEB_URL/${js_file:-assets/none-found.js}" \
    "${WEB_SECURITY[@]}" "$WEB_IMMUTABLE" "Vary: Accept-Encoding"
  check_headers 200 "web, map worker headers" "$WEB_URL/assets/${worker:-none-found.mjs}" \
    "${WEB_SECURITY[@]}" "$WEB_IMMUTABLE" "Vary: Accept-Encoding"
else
  echo "SKIP web checks: nothing at $WEB_URL (start it with docker compose --profile web up)"
fi

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
