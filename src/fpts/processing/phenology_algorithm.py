from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence

# Fraction of the seasonal amplitude used for SOS/EOS when the caller does not choose one.
DEFAULT_THRESHOLD_FRAC = 0.5


@dataclass(frozen=True)
class PhenologyDates:
    sos_doy: Optional[int]  # start of season day-of-year
    eos_doy: Optional[int]  # end of season day-of-year
    season_length: Optional[int]


def compute_sos_eos_threshold(
    ndvi: Sequence[float],
    doys: Sequence[int],
    frac: float = DEFAULT_THRESHOLD_FRAC,
) -> PhenologyDates:
    """
    Compute Start/End of Season (SOS/EOS) from an NDVI time series using a dynamic threshold.

    threshold = ndvi_min + frac * (ndvi_max - ndvi_min)

    SOS = first DOY where NDVI >= threshold
    EOS = last DOY where NDVI >= threshold

    Returns day-of-year (DOY) integers.
    """
    if len(ndvi) != len(doys):
        raise ValueError("ndvi and doys must have the same length")
    if len(ndvi) == 0:
        return PhenologyDates(None, None, None)
    if not (0.0 < frac < 1.0):
        raise ValueError("frac must be between 0 and 1 (exclusive)")

    threshold = ndvi_threshold(ndvi, frac)
    # Flat signal: no seasonality detectable
    if threshold is None:
        return PhenologyDates(None, None, None)

    above = [idx for idx, val in enumerate(ndvi) if val >= threshold]
    if not above:
        return PhenologyDates(None, None, None)

    sos_idx = above[0]
    eos_idx = above[-1]

    sos = doys[sos_idx]
    eos = doys[eos_idx]

    season_length = eos - sos if eos >= sos else None
    return PhenologyDates(sos, eos, season_length)


def ndvi_threshold(ndvi: Sequence[float], frac: float = DEFAULT_THRESHOLD_FRAC) -> Optional[float]:
    """
    The NDVI level SOS/EOS are measured against: ndvi_min + frac * (ndvi_max - ndvi_min).
    None for an empty or flat series, which has no season.
    """
    if len(ndvi) == 0:
        return None
    ndvi_min = min(ndvi)
    ndvi_max = max(ndvi)
    if ndvi_max == ndvi_min:
        return None
    return ndvi_min + frac * (ndvi_max - ndvi_min)
