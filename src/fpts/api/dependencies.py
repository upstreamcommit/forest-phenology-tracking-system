from fastapi import Request

from fpts.config.settings import Settings
from fpts.processing.phenology_service import PhenologyComputationService
from fpts.processing.raster_service import RasterService
from fpts.query.catalog import CatalogService
from fpts.query.service import QueryService


def get_query_service(request: Request) -> QueryService:
    return request.app.state.query_service


def get_catalog_service(request: Request) -> CatalogService:
    return request.app.state.catalog_service


def get_raster_service(request: Request) -> RasterService:
    return request.app.state.raster_service


def get_phenology_compute_service(request: Request) -> PhenologyComputationService:
    return request.app.state.phenology_compute_service


def get_settings(request: Request) -> Settings:
    return request.app.state.settings
