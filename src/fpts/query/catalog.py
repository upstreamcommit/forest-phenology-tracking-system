from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fpts.cache.ttl_cache import InMemoryTTLCache
from fpts.domain.models import BoundingBox, RasterCoverage, StoredCoverage
from fpts.domain.products import ProductInfo, product_info
from fpts.processing.ndvi_stack import raster_extent
from fpts.storage.phenology_repository import PhenologyRepository
from fpts.storage.raster_repository import RasterRepository
from fpts.utils.logging import get_logger

logger = get_logger(__name__)

_CACHE_KEY = "catalog"
# The compute path reads x as longitude and y as latitude, so only these stacks are usable.
_SUPPORTED_RASTER_CRS = "EPSG:4326"


@dataclass(frozen=True)
class ProductCatalogEntry:
    product: str
    info: ProductInfo
    stored: Optional[StoredCoverage]
    computed: Optional[RasterCoverage]


class CatalogService:
    """
    Answers "what data is there?": per product, which years and area have stored metrics and
    which have NDVI stacks to compute from. Cached briefly, since it only changes on reseeding.
    """

    def __init__(
        self,
        repository: PhenologyRepository,
        raster_repo: RasterRepository,
        *,
        ttl_seconds: float = 60.0,
    ) -> None:
        self._repository = repository
        self._raster_repo = raster_repo
        self._cache = InMemoryTTLCache[str, list[ProductCatalogEntry]](
            maxsize=1, ttl_seconds=ttl_seconds
        )

    def list_products(self) -> list[ProductCatalogEntry]:
        cached = self._cache.get(_CACHE_KEY)
        if cached is not None:
            return cached

        stored = self._repository.get_stored_coverage()
        computed: dict[str, RasterCoverage] = {}
        for product in self._raster_repo.list_stack_products():
            coverage = self._raster_coverage(product)
            if coverage is not None:
                computed[product] = coverage

        entries = [
            ProductCatalogEntry(
                product=product,
                info=product_info(product),
                stored=stored.get(product),
                computed=computed.get(product),
            )
            for product in sorted(set(stored) | set(computed))
        ]
        self._cache.set(_CACHE_KEY, entries)
        return entries

    def _raster_coverage(self, product: str) -> RasterCoverage | None:
        years: list[int] = []
        bbox: BoundingBox | None = None
        pixel_size: float | None = None

        for year in self._raster_repo.list_stack_years(product):
            paths = self._raster_repo.list_ndvi_stack_paths(product=product, year=year)
            if not paths:
                continue
            # One bad stack must not hide the others, so skip it and say why in the log.
            try:
                extent = raster_extent(paths[0])
                if extent.crs != _SUPPORTED_RASTER_CRS:
                    raise ValueError(f"CRS {extent.crs} is not {_SUPPORTED_RASTER_CRS}")
                min_x, min_y, max_x, max_y = extent.bounds
                year_bbox = BoundingBox(min_lon=min_x, min_lat=min_y, max_lon=max_x, max_lat=max_y)
            except ValueError as e:
                logger.warning(
                    "catalog_skipped_stack",
                    extra={"product": product, "year": year, "reason": str(e)},
                )
                continue

            bbox = year_bbox if bbox is None else bbox.union(year_bbox)
            pixel_size = extent.pixel_size[0] if pixel_size is None else pixel_size
            years.append(year)

        if bbox is None or pixel_size is None:
            return None
        return RasterCoverage(years=tuple(years), bbox=bbox, pixel_size_deg=pixel_size)
