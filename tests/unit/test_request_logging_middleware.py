import uuid

from fastapi.testclient import TestClient

from fpts.api.main import create_app
from fpts.config.settings import Settings


def test_request_logging_middleware_adds_request_id():
    app = create_app(Settings(environment="development"))
    client = TestClient(app)

    resp = client.get("/health")

    assert resp.status_code == 200
    assert "x-request-id" in resp.headers
    assert uuid.UUID(resp.headers["x-request-id"])  # header format
