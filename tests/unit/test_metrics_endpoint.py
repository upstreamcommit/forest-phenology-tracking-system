from fastapi.testclient import TestClient

from fpts.api.main import create_app
from fpts.config.settings import Settings


def test_metrics_endpoint_disabled_by_default():
    app = create_app(Settings(environment="development"))
    client = TestClient(app)

    resp = client.get("/metrics")
    assert resp.status_code == 404


def test_metrics_endpoint_enabled():
    app = create_app(Settings(environment="development", enable_metrics=True))
    client = TestClient(app)

    resp = client.get("/metrics")

    assert resp.status_code == 200
    # Prometheus text format
    assert "text/plain" in resp.headers.get("content-type", "")
    assert len(resp.text) > 0
