"""OutOfCoverageError must behave like an ordinary exception.

Starlette 1.10+ sets ``exc.__traceback__ = None`` after an exception handler has run. While the
error was a frozen dataclass that assignment raised FrozenInstanceError, so every out-of-coverage
request logged an unhandled server exception after its 422 had been sent.
"""

import pickle

from fpts.domain.errors import OutOfCoverageError

FIELDS = {
    "lat": 52.5,
    "lon": -1.0,
    "tolerance_deg": 0.005,
    "x_min": -0.495,
    "x_max": -0.405,
    "y_min": 51.405,
    "y_max": 51.495,
}


def test_a_handled_error_can_drop_its_traceback_and_take_notes():
    err = OutOfCoverageError(**FIELDS)

    err.__traceback__ = None  # what Starlette 1.10+ does once the handler has responded
    err.add_note("handled")

    assert err.__traceback__ is None


def test_keeps_its_fields_and_message():
    err = OutOfCoverageError(**FIELDS)

    assert {name: getattr(err, name) for name in FIELDS} == FIELDS
    assert str(err).startswith("Location outside raster coverage: lat=52.5, lon=-1.0 ")


def test_survives_pickling():
    err = pickle.loads(pickle.dumps(OutOfCoverageError(**FIELDS)))

    assert {name: getattr(err, name) for name in FIELDS} == FIELDS
