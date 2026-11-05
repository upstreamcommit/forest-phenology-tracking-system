from fastapi import APIRouter, Depends

from fpts.api.dependencies import get_catalog_service
from fpts.api.schemas import (
    BBox,
    CatalogResponse,
    ComputedCoverageSchema,
    ProductSchema,
    StoredCoverageSchema,
)
from fpts.domain.models import BoundingBox
from fpts.processing.phenology_algorithm import DEFAULT_THRESHOLD_FRAC
from fpts.query.catalog import CatalogService

router = APIRouter(tags=["catalog"])


def _bbox(box: BoundingBox) -> BBox:
    # Raster bounds come from affine maths, so trim float noise such as 51.400000000000006.
    return (
        round(box.min_lon, 9),
        round(box.min_lat, 9),
        round(box.max_lon, 9),
        round(box.max_lat, 9),
    )


@router.get("/catalog", response_model=CatalogResponse)
def get_catalog(catalog_service: CatalogService = Depends(get_catalog_service)):
    """
    List the products the API can answer for, with the years and area of stored metrics and of
    NDVI stacks that metrics can be computed from. Clients should use this instead of
    hard-coding product names, years or extents.
    """
    products = []
    for entry in catalog_service.list_products():
        stored = entry.stored
        computed = entry.computed
        products.append(
            ProductSchema(
                id=entry.product,
                label=entry.info.label,
                description=entry.info.description,
                synthetic=entry.info.synthetic,
                stored=(
                    StoredCoverageSchema(
                        years=list(stored.years),
                        bbox=_bbox(stored.bbox),
                        grid_step_deg=stored.grid_step_deg,
                    )
                    if stored is not None
                    else None
                ),
                computed=(
                    ComputedCoverageSchema(
                        years=list(computed.years),
                        bbox=_bbox(computed.bbox),
                        pixel_size_deg=round(computed.pixel_size_deg, 9),
                    )
                    if computed is not None
                    else None
                ),
            )
        )

    return CatalogResponse(products=products, default_threshold_frac=DEFAULT_THRESHOLD_FRAC)
