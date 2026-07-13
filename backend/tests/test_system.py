from fastapi.testclient import TestClient

from app.main import app


def test_health_endpoint() -> None:
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "healthy"
    assert payload["service"] == "backend"
    assert payload["version"]


def test_system_endpoint_reports_required_services() -> None:
    with TestClient(app) as client:
        response = client.get("/api/system")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] in {"healthy", "degraded"}
    assert {"api", "database", "ffmpeg", "opencv"}.issubset(payload["checks"])
    assert payload["checks"]["api"]["healthy"] is True
    assert payload["checks"]["database"]["healthy"] is True
