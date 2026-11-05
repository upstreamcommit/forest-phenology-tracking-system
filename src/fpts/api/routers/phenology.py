import math
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.exceptions import RequestValidationError

from fpts.api.dependencies import (
    get_phenology_compute_service,
    get_query_service,
    get_settings,
)
from fpts.api.schemas import (
    GeoJSONPolygonRequest,
    GridFeature,
    GridPointGeometry,
    GridPointProperties,
    LocationSchema,
    NdviObservationSchema,
    PhenologyAreaStatsResponse,
    PhenologyGridResponse,
    PhenologyNdviCurveResponse,
    PhenologyPointResponse,
    PhenologyPointsRequest,
    PhenologyTimeseriesResponse,
    PhenologyYearMetricSchema,
    SeasonLengthStat,
)
from fpts.config.settings import Settings
from fpts.domain.models import BoundingBox, Location
from fpts.processing.phenology_algorithm import DEFAULT_THRESHOLD_FRAC
from fpts.processing.phenology_service import PhenologyComputationService
from fpts.query.service import QueryService
from fpts.utils.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/phenology", tags=["phenology"])


@router.get("/point", response_model=PhenologyPointResponse)
def get_point_phenology(
    lat: float = Query(..., ge=-90.0, le=90.0, description="Latitude value for the point."),
    lon: float = Query(..., ge=-180.0, le=180.0, description="Longitude value for the point."),
    year: int = Query(..., ge=2000, le=2027, description="Year we want to analyse."),
    mode: Literal["repo", "compute", "auto"] = Query(
        "repo",
        description=(
            "Execution mode. 'repo' returns precomputed metrics, "
            "'compute' calculates on request, and "
            "'auto' tries repo first then falls back to compute."
        ),
    ),
    product: str = Query("ndvi_synth", min_length=1, description="Product to analyse."),
    threshold_frac: float = Query(
        DEFAULT_THRESHOLD_FRAC,
        gt=0.0,
        lt=1.0,
        description=(
            "Fraction of the seasonal NDVI amplitude used for SOS/EOS when computing. "
            "Stored metrics only exist for the default, so any other value is rejected in "
            "mode=repo and makes mode=auto compute directly."
        ),
    ),
    query_service: QueryService = Depends(get_query_service),
    compute_service: PhenologyComputationService = Depends(get_phenology_compute_service),
):
    """
    Get phenology metrics for a single point.

    mode=repo:
      Reads from repository (PostGIS).

    mode=compute:
      Computes from NDVI raster stack on the fly (currently synthetic NDVI stack).

    mode=auto:
      Tries to read from repo, and falls back to compute from NDVI raster stack on the fly
      (currently synthetic NDVI stack). With a non-default threshold_frac it computes directly.
    """
    logger.info(
        "point_query_received",
        extra={
            "lat": lat,
            "lon": lon,
            "year": year,
            "mode": mode,
            "product": product,
            "threshold_frac": threshold_frac,
        },
    )

    location = Location(lat=lat, lon=lon)
    # Stored metrics are not tied to a threshold, so only the default can be served from the repo.
    custom_threshold = threshold_frac != DEFAULT_THRESHOLD_FRAC

    if mode == "repo" and custom_threshold:
        # Same 422 body as FastAPI's own parameter validation, which OpenAPI documents.
        raise RequestValidationError(
            [
                {
                    "type": "value_error",
                    "loc": ("query", "threshold_frac"),
                    "msg": (
                        "threshold_frac only applies when computing: use mode=compute or "
                        "mode=auto, or omit it to read stored metrics "
                        f"(default {DEFAULT_THRESHOLD_FRAC})"
                    ),
                    # FastAPI reports query inputs as the raw string; match that.
                    "input": str(threshold_frac),
                }
            ]
        )

    metric = None
    if mode in ("repo", "auto") and not custom_threshold:
        metric = query_service.get_point_metric(product=product, location=location, year=year)
        if metric is None and mode == "repo":
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No phenology data found for product: {product}, "
                    f"location: lat={lat}, lon={lon} and year: {year}"
                ),
            )

    if metric is None:  # mode=compute, or auto after a repo miss or with a custom threshold
        try:
            metric = compute_service.compute_point_phenology(
                product=product,
                year=year,
                location=location,
                threshold_frac=threshold_frac,
            )
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e

    return PhenologyPointResponse(
        year=metric.year,
        location=LocationSchema(lat=metric.location.lat, lon=metric.location.lon),
        sos_date=metric.sos_date,
        eos_date=metric.eos_date,
        season_length=metric.season_length,
        is_forest=metric.is_forest,
    )


@router.post("/points", response_model=list[PhenologyPointResponse])
def get_points_phenology(
    body: PhenologyPointsRequest = Body(...),
    year: int = Query(..., ge=2000, le=2027, description="Year we want to analyse."),
    product: str = Query("ndvi_synth", min_length=1, description="Product to analyse."),
    threshold_frac: float = Query(
        DEFAULT_THRESHOLD_FRAC, gt=0.0, lt=1.0, description="Fraction value used in SOS/EOS limits."
    ),
    compute_service: PhenologyComputationService = Depends(get_phenology_compute_service),
):
    locations = [Location(lat=loc.lat, lon=loc.lon) for loc in body.locations]
    try:
        metrics = compute_service.compute_points_phenology(
            product=product,
            year=year,
            locations=locations,
            threshold_frac=threshold_frac,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return [
        PhenologyPointResponse(
            year=m.year,
            location=LocationSchema(lat=m.location.lat, lon=m.location.lon),
            sos_date=m.sos_date,
            eos_date=m.eos_date,
            season_length=m.season_length,
            is_forest=m.is_forest,
        )
        for m in metrics
    ]


@router.get(
    "/timeseries",
    response_model=PhenologyTimeseriesResponse,
    responses={
        404: {"description": "No data found"},
        400: {"description": "Invalid parameters"},
    },
)
def get_point_timeseries(
    lat: float = Query(..., ge=-90.0, le=90.0, description="Latitude value for the point."),
    lon: float = Query(..., ge=-180.0, le=180.0, description="Longitude value for the point."),
    start_year: int = Query(..., ge=2000, le=2027, description="Start year (inclusive)."),
    end_year: int = Query(..., ge=2000, le=2027, description="End year (inclusive)."),
    product: str = Query("ndvi_synth", min_length=1, description="Product to analyse."),
    query_service: QueryService = Depends(get_query_service),
):
    logger.info(
        "timeseries_query_recieved",
        extra={
            "lat": lat,
            "lon": lon,
            "start_year": start_year,
            "end_year": end_year,
            "product": product,
        },
    )

    if end_year < start_year:
        raise HTTPException(
            status_code=400, detail="Invalid parameters: end_year must be >= start_year"
        )

    location = Location(lat=lat, lon=lon)

    metrics = query_service.get_point_timeseries(
        product=product,
        location=location,
        start_year=start_year,
        end_year=end_year,
    )

    if not metrics:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No phenology data found for product: {product}, "
                f"location: lat={lat}, lon={lon} and year range: {start_year}-{end_year}"
            ),
        )

    return PhenologyTimeseriesResponse(
        product=product,
        location=LocationSchema(lat=location.lat, lon=location.lon),
        start_year=start_year,
        end_year=end_year,
        metrics=[
            PhenologyYearMetricSchema(
                year=metric.year,
                sos_date=metric.sos_date,
                eos_date=metric.eos_date,
                season_length=metric.season_length,
                is_forest=metric.is_forest,
            )
            for metric in metrics
        ],
    )


@router.post("/area", response_model=PhenologyAreaStatsResponse)
def get_area_phenology_stats(
    payload: GeoJSONPolygonRequest = Body(...),
    year: int = Query(..., ge=2000, le=2027, description="Year we want to analyse."),
    product: str = Query("ndvi_synth", min_length=1, description="Product to analyse."),
    only_forest: bool = Query(False, description="If True, only include forest points."),
    season_length_stat: SeasonLengthStat = Query(
        SeasonLengthStat.mean,
        description="How to summarise season_length: mean, median, or both.",
    ),
    min_season_length: int | None = Query(
        None,
        ge=0,
        le=366,
        description="If set, only include rows with season_length >= this value.",
    ),
    query_service: QueryService = Depends(get_query_service),
):
    logger.info(
        "area_stats_query_received",
        extra={
            "year": year,
            "product": product,
            "payload": payload,
        },
    )

    try:
        stats = query_service.get_area_stats(
            product=product,
            year=year,
            polygon_geojson=payload.geometry,
            only_forest=only_forest,
            min_season_length=min_season_length,
            season_length_stat=season_length_stat.value,
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid GeoJSON geometry")

    if stats is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "No phenology data found intersecting this polygon "
                f"for product: {product} and year: {year}"
            ),
        )

    return PhenologyAreaStatsResponse(
        product=product,
        year=year,
        n=stats["n"],
        mean_season_length=stats.get("mean_season_length"),
        median_season_length=stats.get("median_season_length"),
        forest_fraction=stats.get("forest_fraction"),
    )


def _bbox_error(
    bbox: str | None, msg: str, *, error_type: str = "value_error", ctx: dict | None = None
) -> RequestValidationError:
    # Same 422 body as FastAPI's own parameter validation, which OpenAPI documents.
    error: dict = {"type": error_type, "loc": ("query", "bbox"), "msg": msg, "input": bbox}
    if ctx is not None:
        error["ctx"] = ctx
    return RequestValidationError([error])


def _parse_bbox(bbox: str | None) -> BoundingBox | None:
    if bbox is None:
        return None
    parts = bbox.split(",")
    if len(parts) != 4:
        raise _bbox_error(bbox, "bbox must be four comma-separated numbers")
    try:
        min_lon, min_lat, max_lon, max_lat = (float(p) for p in parts)
        return BoundingBox(min_lon=min_lon, min_lat=min_lat, max_lon=max_lon, max_lat=max_lat)
    except ValueError as e:
        raise _bbox_error(bbox, f"Invalid bbox: {e}") from e


@router.get("/grid", response_model=PhenologyGridResponse)
def get_phenology_grid(
    year: int = Query(..., ge=2000, le=2027, description="Year we want to analyse."),
    product: str = Query("ndvi_synth", min_length=1, description="Product to analyse."),
    bbox: str | None = Query(
        None,
        description=(
            "min_lon,min_lat,max_lon,max_lat in WGS84 degrees, edges inclusive. It may not "
            "cross the antimeridian, so clamp web-map bounds to [-180, 180] first. Omit it for "
            "every stored point."
        ),
        examples=["-1.5,52.0,-0.5,53.0"],
    ),
    query_service: QueryService = Depends(get_query_service),
    settings: Settings = Depends(get_settings),
):
    """
    Stored metrics for every grid point of one product and year, as a GeoJSON
    FeatureCollection of points ordered by lat then lon. Point coordinates are exactly as
    stored, so they can be passed back to /point (mode=repo) and /timeseries unchanged.
    An area with no stored points returns an empty collection.

    422 errors on `bbox` have type `value_error` for a malformed box, and `too_many_features`
    (with `ctx.limit`, and `input` null when no bbox was sent) when more points match than the
    server returns at once.
    """
    box = _parse_bbox(bbox)
    limit = settings.grid_max_features

    # One row past the limit tells a full result from a truncated one.
    metrics = query_service.get_grid(product=product, year=year, bbox=box, limit=limit + 1)
    if len(metrics) > limit:
        raise _bbox_error(
            bbox,
            f"The request matches more than {limit} points; use a smaller bbox",
            error_type="too_many_features",
            ctx={"limit": limit},
        )

    return PhenologyGridResponse(
        product=product,
        year=year,
        requested_bbox=(box.min_lon, box.min_lat, box.max_lon, box.max_lat) if box else None,
        features=[
            GridFeature(
                geometry=GridPointGeometry(coordinates=(m.location.lon, m.location.lat)),
                properties=GridPointProperties(
                    sos_date=m.sos_date,
                    eos_date=m.eos_date,
                    season_length=m.season_length,
                    is_forest=m.is_forest,
                ),
            )
            for m in metrics
        ],
    )


# Stacks hold float32, so 0.7 arrives as 0.699999988; six decimals is well beyond NDVI precision.
_NDVI_DECIMALS = 6
# Pixel centres come from affine maths (51.404999999999994); nine decimals is about 0.1 mm.
_COORD_DECIMALS = 9


def _ndvi(value: float) -> float | None:
    # A composite without a value (NaN) is null rather than an invalid JSON number.
    return round(value, _NDVI_DECIMALS) if math.isfinite(value) else None


@router.get(
    "/point/ndvi",
    response_model=PhenologyNdviCurveResponse,
    responses={404: {"description": "No raster stack for this product and year"}},
)
def get_point_ndvi_curve(
    lat: float = Query(..., ge=-90.0, le=90.0, description="Latitude value for the point."),
    lon: float = Query(..., ge=-180.0, le=180.0, description="Longitude value for the point."),
    year: int = Query(..., ge=2000, le=2027, description="Year we want to analyse."),
    product: str = Query("ndvi_synth", min_length=1, description="Product to analyse."),
    threshold_frac: float = Query(
        DEFAULT_THRESHOLD_FRAC,
        gt=0.0,
        lt=1.0,
        description="Fraction of the seasonal NDVI amplitude used for SOS/EOS.",
    ),
    compute_service: PhenologyComputationService = Depends(get_phenology_compute_service),
):
    """
    The NDVI observations at the pixel nearest the point, with the threshold and the SOS/EOS
    that mode=compute derives from them. Like mode=compute, a point outside the raster stack
    returns the 422 out_of_coverage body, and a missing stack returns 404.
    """
    location = Location(lat=lat, lon=lon)
    try:
        curve = compute_service.compute_point_curve(
            product=product, year=year, location=location, threshold_frac=threshold_frac
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    return PhenologyNdviCurveResponse(
        product=product,
        year=curve.year,
        location=LocationSchema(lat=lat, lon=lon),
        pixel=LocationSchema(
            lat=round(curve.pixel.lat, _COORD_DECIMALS), lon=round(curve.pixel.lon, _COORD_DECIMALS)
        ),
        observations=[
            NdviObservationSchema(
                doy=doy,
                date=date(curve.year, 1, 1) + timedelta(days=doy - 1),
                ndvi=_ndvi(ndvi),
            )
            for doy, ndvi in zip(curve.doys, curve.ndvi, strict=True)
        ],
        threshold_frac=curve.threshold_frac,
        threshold_ndvi=None if curve.threshold_ndvi is None else _ndvi(curve.threshold_ndvi),
        sos_date=curve.sos_date,
        eos_date=curve.eos_date,
        season_length=curve.season_length,
    )
