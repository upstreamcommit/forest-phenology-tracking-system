import re
from pathlib import Path
from typing import Sequence

from fpts.storage.raster_repository import RasterRepository

# ASCII digits only: str.isdigit() also accepts characters such as "²" that int() rejects.
_YEAR_DIR = re.compile(r"[0-9]{4}")


class LocalRasterRepository(RasterRepository):
    """
    Local filesystem implementation.

    Folder convention (v1):
      {data_dir}/raw/{product}/{year}.tif

    Example:
      data/raw/mcd12q2/2020.tif
    """

    def __init__(self, data_dir: str | Path) -> None:
        self._data_dir = Path(data_dir)

    def raw_raster_path(self, product: str, year: int) -> Path:
        return self._data_dir / "raw" / product / f"{year}.tif"

    def exists(self, product: str, year: int) -> bool:
        return self.raw_raster_path(product, year).exists()

    def list_ndvi_stack_paths(self, product: str, year: int) -> Sequence[Path]:
        stack_dir = self._data_dir / "raw" / product / str(year)
        if not stack_dir.exists():
            return []
        return sorted(stack_dir.glob("doy_*.tif"))

    def list_stack_products(self) -> list[str]:
        raw_dir = self._data_dir / "raw"
        if not raw_dir.is_dir():
            return []
        return sorted(
            d.name
            for d in raw_dir.iterdir()
            if d.is_dir() and not d.name.startswith(".") and self.list_stack_years(d.name)
        )

    def list_stack_years(self, product: str) -> list[int]:
        product_dir = self._data_dir / "raw" / product
        if not product_dir.is_dir():
            return []
        return sorted(
            int(d.name)
            for d in product_dir.iterdir()
            if d.is_dir() and _YEAR_DIR.fullmatch(d.name) and any(d.glob("doy_*.tif"))
        )
