import os
import time
from pathlib import Path

import psycopg
import pytest

from fpts.api.main import create_app
from fpts.config.settings import Settings

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


def _wait_for_db(dsn: str, *, timeout_s: float = 30.0) -> None:
    deadline = time.time() + timeout_s
    last_err: Exception | None = None

    while time.time() < deadline:
        try:
            with psycopg.connect(dsn) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1;")
                    cur.fetchone()
            return
        except Exception as e:
            last_err = e
            time.sleep(0.5)

    raise RuntimeError(f"PostGIS test DB not ready after {timeout_s}s: {last_err}")


@pytest.fixture(scope="session")
def postgis_dsn() -> str:
    if load_dotenv is not None:
        env_test = Path(".env.test")
        if env_test.exists():
            load_dotenv(env_test)

    dsn = os.getenv("FPTS_TEST_DATABASE_DSN")
    if not dsn:
        message = "Set FPTS_TEST_DATABASE_DSN to run PostGIS integration tests"
        # Callers that expect integration tests to run (pre-push hook, CI) set this so a
        # missing DSN fails loudly instead of skipping all tests and exiting 0.
        if os.getenv("FPTS_REQUIRE_INTEGRATION") == "1":
            pytest.fail(message)
        pytest.skip(message)
    _wait_for_db(dsn)
    return dsn


@pytest.fixture(autouse=True)
def _clean_phenology_metrics(postgis_dsn: str):
    """
    Ensure isolation between integration tests.
    Runs before each test in tests/integration/.
    """
    with psycopg.connect(postgis_dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE TABLE public.phenology_metrics RESTART IDENTITY;")
        conn.commit()


@pytest.fixture
def app_postgis(postgis_dsn: str):
    return create_app(
        settings=Settings(
            phenology_repo_backend="postgis",
            database_dsn=postgis_dsn,
        )
    )
