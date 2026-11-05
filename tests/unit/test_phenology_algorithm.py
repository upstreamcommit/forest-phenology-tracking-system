import pytest

from fpts.processing.phenology_algorithm import compute_sos_eos_threshold, ndvi_threshold


def test_compute_sos_eos_detects_season():
    # Synthetic NDVI curve: low in winter, high in summer
    doys = [1, 50, 100, 150, 200, 250, 300, 350]
    ndvi = [0.1, 0.12, 0.2, 0.5, 0.7, 0.6, 0.25, 0.12]

    result = compute_sos_eos_threshold(ndvi=ndvi, doys=doys, frac=0.5)

    # min=0.1, max=0.7 → threshold = 0.1 + 0.5*(0.6)=0.4
    # first >=0.4 is at DOY 150 (0.5)
    # last  >=0.4 is at DOY 250 (0.6)
    assert result.sos_doy == 150
    assert result.eos_doy == 250
    assert result.season_length == 100


def test_compute_sos_eos_flat_signal_returns_none():
    doys = [1, 100, 200, 300]
    ndvi = [0.2, 0.2, 0.2, 0.2]

    result = compute_sos_eos_threshold(ndvi=ndvi, doys=doys)

    assert result.sos_doy is None
    assert result.eos_doy is None
    assert result.season_length is None


def test_compute_sos_eos_empty_returns_none():
    result = compute_sos_eos_threshold(ndvi=[], doys=[])
    assert result.sos_doy is None
    assert result.eos_doy is None
    assert result.season_length is None


def test_ndvi_threshold_is_the_fraction_of_the_amplitude_above_the_minimum():
    ndvi = [0.1, 0.12, 0.2, 0.5, 0.7, 0.6, 0.25, 0.12]

    assert ndvi_threshold(ndvi, 0.5) == pytest.approx(0.4)
    assert ndvi_threshold(ndvi, 0.2) == pytest.approx(0.22)


def test_ndvi_threshold_is_none_without_a_season():
    assert ndvi_threshold([], 0.5) is None
    assert ndvi_threshold([0.3, 0.3, 0.3], 0.5) is None
