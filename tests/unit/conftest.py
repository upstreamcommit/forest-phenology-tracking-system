from pathlib import Path

import pytest

from fpts.api.main import create_app
from fpts.config.settings import Settings


@pytest.fixture
def app_memory():
    fixtures_root = Path(__file__).resolve().parents[1] / "fixtures"
    return create_app(
        settings=Settings(phenology_repo_backend="memory", data_dir=str(fixtures_root))
    )
