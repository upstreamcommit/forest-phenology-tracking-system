UPSERT_MANY = """
INSERT INTO phenology_metrics (
    product, year, lon, lat, geom,
    sos_date, eos_date, season_length, is_forest
)
VALUES (
    %(product)s, %(year)s, %(lon)s, %(lat)s,
    ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326),
    %(sos_date)s, %(eos_date)s, %(season_length)s, %(is_forest)s
)
ON CONFLICT (product, year, lon, lat)
DO UPDATE SET
    sos_date = EXCLUDED.sos_date,
    eos_date = EXCLUDED.eos_date,
    season_length = EXCLUDED.season_length,
    is_forest = EXCLUDED.is_forest;
"""

GET_METRIC_FOR_LOCATION = """
SELECT
    year,
    lat,
    lon,
    sos_date,
    eos_date,
    season_length,
    is_forest
FROM phenology_metrics
WHERE
    product = %(product)s
    AND year = %(year)s
    AND lat = %(lat)s
    AND lon = %(lon)s
"""

GET_TIMESERIES_FOR_LOCATION = """
SELECT
    year,
    lat,
    lon,
    sos_date,
    eos_date,
    season_length,
    is_forest
FROM phenology_metrics
WHERE
    product = %(product)s
    AND lat = %(lat)s
    AND lon = %(lon)s
    AND year BETWEEN %(start_year)s AND %(end_year)s
ORDER BY year ASC
"""

GET_AREA_STATS = """
WITH poly AS (
    SELECT ST_SetSRID(ST_GeomFromGeoJSON(%(poly)s), 4326) AS g
),
flags AS (
    SELECT
        g,
        (g IS NOT NULL) AS not_null,
        (g IS NOT NULL AND NOT ST_IsEmpty(g)) AS not_empty,
        (g IS NOT NULL AND ST_IsValid(g)) AS is_valid,
        (g IS NOT NULL AND NOT ST_IsEmpty(g) AND ST_IsValid(g)) AS ok
    FROM poly
)
SELECT
    f.ok AS ok,
    COUNT(m.*)::int AS n,
    AVG(m.season_length)::float AS mean_season_length,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY m.season_length)::float AS median_season_length,
    AVG(CASE WHEN m.is_forest THEN 1 ELSE 0 END)::float AS forest_fraction
FROM flags f
LEFT JOIN phenology_metrics m
    ON f.ok
    AND m.product = %(product)s
    AND m.year = %(year)s
    AND ST_Covers(f.g, m.geom)
    AND (%(only_forest)s::boolean = false OR m.is_forest = true)
    AND (
        %(min_season_length)s::int IS NULL
        OR (m.season_length IS NOT NULL AND m.season_length >= %(min_season_length)s::int)
    )
GROUP BY f.ok
"""

GET_GRID = """
SELECT
    year,
    lat,
    lon,
    sos_date,
    eos_date,
    season_length,
    is_forest
FROM phenology_metrics
WHERE
    product = %(product)s
    AND year = %(year)s
    AND lon BETWEEN %(min_lon)s AND %(max_lon)s
    AND lat BETWEEN %(min_lat)s AND %(max_lat)s
ORDER BY lat ASC, lon ASC
LIMIT %(limit)s
"""

# Per product: the stored years, the extent, and the smallest gap between distinct longitudes.
GET_STORED_COVERAGE = """
WITH extents AS (
    SELECT
        product,
        array_agg(DISTINCT year ORDER BY year) AS years,
        MIN(lon) AS min_lon,
        MIN(lat) AS min_lat,
        MAX(lon) AS max_lon,
        MAX(lat) AS max_lat
    FROM phenology_metrics
    GROUP BY product
),
lon_steps AS (
    SELECT product, MIN(step) AS grid_step_deg
    FROM (
        SELECT product, lon - LAG(lon) OVER (PARTITION BY product ORDER BY lon) AS step
        FROM (SELECT DISTINCT product, lon FROM phenology_metrics) AS distinct_lons
    ) AS steps
    WHERE step > %(min_step)s
    GROUP BY product
)
SELECT
    e.product,
    e.years,
    e.min_lon,
    e.min_lat,
    e.max_lon,
    e.max_lat,
    s.grid_step_deg
FROM extents e
LEFT JOIN lon_steps s USING (product)
ORDER BY e.product
"""
