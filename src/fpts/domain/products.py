from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class ProductInfo:
    """
    Descriptive facts about a product that the data itself can't tell us.
    """

    label: str
    description: str
    # None when the product isn't registered here, so its origin is unknown.
    synthetic: Optional[bool]


_PRODUCTS: dict[str, ProductInfo] = {
    "ndvi_synth": ProductInfo(
        label="Synthetic NDVI",
        description=(
            "Generated demonstration data with plausible spatial and year-to-year patterns. "
            "It is not derived from satellite observations."
        ),
        synthetic=True,
    ),
}


def product_info(product: str) -> ProductInfo:
    """
    Registered facts for a product, or a neutral placeholder for one found only in the data.
    """
    return _PRODUCTS.get(product, ProductInfo(label=product, description="", synthetic=None))
