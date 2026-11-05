"""
The invented seasonal model behind the synthetic demo data, shared by the stored-metrics CSV
(generate_seed_metrics.py) and the NDVI raster stacks (make_synthetic_ndvi_stack.py), so the two
roughly agree where they overlap.

It covers a plain lon/lat rectangle around Great Britain, so sea points get seasons too. Uplands
and woodland clusters are placed loosely where real ones are, but nothing here is derived from
observations.
"""

from __future__ import annotations

import hashlib
import math
from functools import lru_cache

FIRST_YEAR = 2016

# Days added to start of season (SOS) per year: negative is an early, warm spring.
SPRING_ANOMALY_DAYS: dict[int, float] = {
    2016: 2.0,
    2017: -6.0,
    2018: 6.0,
    2019: -2.0,
    2020: -5.0,
    2021: 8.0,
    2022: -3.0,
    2023: 3.0,
    2024: -4.0,
    2025: -7.0,
    2026: 0.0,
}

# Days added to end of season (EOS) per year, scaled up towards the south-east: negative is
# an early senescence, as in a summer drought.
SUMMER_DROUGHT_DAYS: dict[int, float] = {
    2016: 2.0,
    2017: 0.0,
    2018: -14.0,
    2019: 3.0,
    2020: -4.0,
    2021: 4.0,
    2022: -16.0,
    2023: -2.0,
    2024: 3.0,
    2025: -10.0,
    2026: 0.0,
}

# (lat, lon, radius in degrees) of invented upland areas, where seasons start later and end
# earlier.
_UPLANDS: tuple[tuple[float, float, float], ...] = (
    (57.0, -4.6, 1.1),
    (56.6, -3.6, 0.6),
    (54.6, -2.3, 0.5),
    (54.5, -3.1, 0.35),
    (52.7, -3.7, 0.55),
    (50.6, -3.9, 0.3),
    (53.4, -1.8, 0.3),
)

# (lat, lon, radius in degrees) of invented woodland clusters.
_WOODLANDS: tuple[tuple[float, float, float], ...] = (
    (55.2, -2.5, 0.45),
    (55.0, -4.4, 0.4),
    (57.1, -3.8, 0.5),
    (56.3, -3.9, 0.35),
    (52.45, 0.7, 0.3),
    (50.87, -1.6, 0.25),
    (51.8, -2.55, 0.25),
    (51.1, -0.4, 0.45),
    (53.2, -1.1, 0.3),
    (52.3, -3.0, 0.35),
    (54.3, -6.5, 0.35),
)


def stable_u01(key: str) -> float:
    """
    Deterministic float in [0, 1) from a string key (stable across runs and machines).
    """
    h = hashlib.sha256(key.encode("utf-8")).digest()
    n = int.from_bytes(h[:8], "big")
    return (n % (10**12)) / float(10**12)


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _bumps(lat: float, lon: float, centres: tuple[tuple[float, float, float], ...]) -> float:
    """
    Sum of Gaussian bumps at the given centres, capped at 1.
    """
    total = 0.0
    for c_lat, c_lon, radius in centres:
        # Degrees of longitude shrink with latitude.
        dx = (lon - c_lon) * math.cos(math.radians(lat))
        dy = lat - c_lat
        total += math.exp(-(dx * dx + dy * dy) / (2.0 * radius * radius))
    return min(1.0, total)


def upland(lat: float, lon: float) -> float:
    """
    0 (lowland) to 1 (upland).
    """
    return _bumps(lat, lon, _UPLANDS)


def woodland(lat: float, lon: float) -> float:
    """
    0 to 1: how strongly a location sits inside a woodland cluster.
    """
    return _bumps(lat, lon, _WOODLANDS)


_WAVES = ((1.7, 0.9), (0.8, 2.3), (3.1, 1.4))


@lru_cache(maxsize=None)
def _phases(seed: str) -> tuple[tuple[float, float], ...]:
    return tuple(
        (
            stable_u01(f"{seed}|a|{i}") * 2.0 * math.pi,
            stable_u01(f"{seed}|b|{i}") * 2.0 * math.pi,
        )
        for i in range(len(_WAVES))
    )


def smooth_noise(lat: float, lon: float, seed: str) -> float:
    """
    A smooth field in about [-1, 1] made from a few sinusoids with seeded phases.
    """
    total = 0.0
    for (f_lat, f_lon), (phase_a, phase_b) in zip(_WAVES, _phases(seed), strict=True):
        total += math.sin(f_lat * lat + phase_a) * math.cos(f_lon * lon + phase_b)
    return total / len(_WAVES)


def south_east_weight(lat: float, lon: float) -> float:
    """
    0 in the north-west to 1 in the south-east, for anomalies that are strongest there.
    """
    return clamp(0.5 + ((52.5 - lat) / 3.0 + (lon + 1.5) / 3.5) / 2.0, 0.0, 1.0)


def is_forest(lat: float, lon: float) -> bool:
    """
    Woodland clusters plus scattered small woods, rarer on uplands. Constant across years.
    """
    p = (
        0.08
        + 0.75 * woodland(lat, lon)
        + 0.12 * smooth_noise(lat, lon, "forest")
        - 0.25 * upland(lat, lon)
    )
    return stable_u01(f"forest|{lat:.5f}|{lon:.5f}") < clamp(p, 0.02, 0.95)


def season_doys(year: int, lat: float, lon: float, forest: bool) -> tuple[float, float]:
    """
    Unrounded start and end of season (day of year) for one point and year:
    - later, shorter seasons further north and on uplands, longer ones in the maritime west;
    - woodland greening earlier and senescing later than open land;
    - a gentle trend towards earlier springs and later autumns;
    - per-year spring anomalies everywhere, and summer droughts strongest in the south-east;
    - a few days of per-point noise.
    """
    west = clamp(-(lon + 2.0) / 5.0, -1.0, 1.0)  # maritime west: positive
    hills = upland(lat, lon)
    texture = smooth_noise(lat, lon, "season")
    years_on = year - FIRST_YEAR

    sos = (
        96.0
        + 2.6 * (lat - 52.0)
        - 3.0 * west
        + 14.0 * hills
        + 3.0 * texture
        - (4.0 if forest else 0.0)
        - 0.35 * years_on
        + SPRING_ANOMALY_DAYS.get(year, 0.0) * (0.8 + 0.2 * smooth_noise(lat, lon, f"spring{year}"))
        + (stable_u01(f"sos|{year}|{lat:.5f}|{lon:.5f}") - 0.5) * 6.0
    )
    eos = (
        292.0
        - 2.0 * (lat - 52.0)
        + 4.0 * west
        - 10.0 * hills
        - 2.0 * texture
        + (6.0 if forest else 0.0)
        + 0.25 * years_on
        + SUMMER_DROUGHT_DAYS.get(year, 0.0) * (0.25 + 0.75 * south_east_weight(lat, lon))
        + (stable_u01(f"eos|{year}|{lat:.5f}|{lon:.5f}") - 0.5) * 6.0
    )
    return sos, eos
