from fastapi.testclient import TestClient

from app.main import app
from app.routes import _parse_classes


def test_health():
    client = TestClient(app)
    assert client.get("/health").json() == {"status": "ok"}


def test_debug_paths():
    client = TestClient(app)
    payload = client.get("/debug/paths").json()
    assert "uploads" in payload
    assert "outputs" in payload
    assert "db" in payload


def test_swagger_placeholder_does_not_replace_default_classes():
    assert _parse_classes("string") is None
    assert _parse_classes("person, cable") == ["person", "cable"]
