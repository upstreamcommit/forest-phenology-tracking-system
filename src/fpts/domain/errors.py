from __future__ import annotations


class OutOfCoverageError(Exception):
    """A location lies outside a raster stack's coverage.

    A plain exception rather than a frozen dataclass: Starlette 1.10+ clears ``__traceback__`` on
    exceptions it has handled, and a frozen dataclass rejects that assignment.
    """

    def __init__(
        self,
        lat: float,
        lon: float,
        tolerance_deg: float,
        x_min: float,
        x_max: float,
        y_min: float,
        y_max: float,
    ) -> None:
        # Pass every field to Exception so args (and so pickling) can rebuild the error.
        super().__init__(lat, lon, tolerance_deg, x_min, x_max, y_min, y_max)
        self.lat = lat
        self.lon = lon
        self.tolerance_deg = tolerance_deg
        self.x_min = x_min
        self.x_max = x_max
        self.y_min = y_min
        self.y_max = y_max

    def __str__(self) -> str:
        return (
            f"Location outside raster coverage: lat={self.lat}, lon={self.lon} "
            f"(tolerance={self.tolerance_deg}°; "
            f"lon range=[{self.x_min}, {self.x_max}], "
            f"lat range=[{self.y_min}, {self.y_max}])"
        )
