from abc import ABC, abstractmethod
from pathlib import Path
from typing import Sequence


class RasterRepository(ABC):
    """
    Abstract interface for finding and managing raw raster files.
    """

    @abstractmethod
    def raw_raster_path(self, product: str, year: int) -> Path:
        """
        Return the expected path for a raw raster for (product, year).
        Does not guarantee the file exists.
        """
        raise NotImplementedError

    @abstractmethod
    def exists(self, product: str, year: int) -> bool:
        """
        Return True if the raster file exists locally.
        """
        raise NotImplementedError

    @abstractmethod
    def list_ndvi_stack_paths(self, product: str, year: int) -> Sequence[Path]:
        """
        Return the list of GeoTIFF paths that form the NDVI stack for (product, year),
        typically one file per time step (e.g. per DOY).
        """
        raise NotImplementedError

    @abstractmethod
    def list_stack_products(self) -> list[str]:
        """
        Return the products that have an NDVI stack for at least one year, sorted.
        """
        raise NotImplementedError

    @abstractmethod
    def list_stack_years(self, product: str) -> list[int]:
        """
        Return the years that have an NDVI stack for the product, sorted.
        """
        raise NotImplementedError
