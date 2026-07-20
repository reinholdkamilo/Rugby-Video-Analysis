from base64 import b64encode

from fastapi.testclient import TestClient

from app.main import app


def basic_auth(username: str, password: str) -> dict[str, str]:
    encoded = b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    return {"Authorization": f"Basic {encoded}"}


def test_hosted_private_mode_blocks_api_without_password(monkeypatch) -> None:
    monkeypatch.setenv("APP_PRIVATE_MODE", "true")
    monkeypatch.delenv("APP_ACCESS_PASSWORD", raising=False)
    with TestClient(app) as client:
        response = client.get("/api/organisations")

    assert response.status_code == 401
    assert response.headers["www-authenticate"].startswith("Basic")


def test_hosted_private_mode_allows_health_without_password(monkeypatch) -> None:
    monkeypatch.setenv("APP_PRIVATE_MODE", "true")
    monkeypatch.delenv("APP_ACCESS_PASSWORD", raising=False)
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200


def test_hosted_private_mode_allows_correct_basic_auth(monkeypatch) -> None:
    monkeypatch.setenv("APP_PRIVATE_MODE", "true")
    monkeypatch.setenv("APP_ACCESS_USERNAME", "coach")
    monkeypatch.setenv("APP_ACCESS_PASSWORD", "private-test-password")
    with TestClient(app) as client:
        denied = client.get("/api/organisations", headers=basic_auth("coach", "wrong"))
        allowed = client.get("/api/organisations", headers=basic_auth("coach", "private-test-password"))

    assert denied.status_code == 401
    assert allowed.status_code == 200
