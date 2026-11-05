from fastapi import FastAPI

from fpts.api.routers.catalog import router as catalog_router
from fpts.api.routers.debug import router as debug_router
from fpts.api.routers.health import router as health_router
from fpts.api.routers.metrics import router as metrics_router
from fpts.api.routers.phenology import router as phenology_router
from fpts.api.wiring import (
    register_exception_handlers,
    wire_in_memory_services,
    wire_postgis_services,
)
from fpts.config.settings import Settings
from fpts.utils.logging import get_logger, setup_logging
from fpts.utils.metrics import PrometheusMetricsMiddleware
from fpts.utils.middleware import RequestLoggingMiddleware

logger = get_logger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    setup_logging(level=settings.log_level, json=(settings.environment == "production"))
    setup_logging(
        level=settings.log_level,
        json=(settings.environment == "production"),
        cache_debug=True,
    )
    logger.debug("debug_logging_enabled")

    app = FastAPI(title=settings.app_name)
    app.state.settings = settings

    if settings.phenology_repo_backend == "postgis":
        wire_postgis_services(app, settings=settings)
    else:
        wire_in_memory_services(app, settings=settings)

    # Routers and middleware
    app.include_router(health_router)
    app.include_router(catalog_router)
    app.include_router(phenology_router)

    app.add_middleware(RequestLoggingMiddleware)

    if settings.enable_metrics:
        app.add_middleware(PrometheusMetricsMiddleware)
        app.include_router(metrics_router)

    if settings.enable_debug_routes or settings.environment != "production":
        app.include_router(debug_router)

    register_exception_handlers(app)

    return app


app = create_app()
