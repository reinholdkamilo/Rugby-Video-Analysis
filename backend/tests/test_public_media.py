from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse, RedirectResponse
import pytest

from app.api.public_media import _serve_media_reference


def test_serve_media_reference_redirects_r2_uri(monkeypatch):
    monkeypatch.setattr(
        "app.api.public_media.create_presigned_get_url",
        lambda reference: f"https://signed.example/{reference.rsplit('/', maxsplit=1)[-1]}",
    )

    response = _serve_media_reference("r2://bucket/clips/event-1.mp4", "video/mp4")

    assert isinstance(response, RedirectResponse)
    assert response.status_code == 307
    assert response.headers["location"] == "https://signed.example/event-1.mp4"


def test_serve_media_reference_serves_local_file(tmp_path: Path):
    local_file = tmp_path / "frame.jpg"
    local_file.write_bytes(b"image")

    response = _serve_media_reference(str(local_file), "image/jpeg")

    assert isinstance(response, FileResponse)
    assert response.media_type == "image/jpeg"


def test_serve_media_reference_reports_missing_local_file(tmp_path: Path):
    with pytest.raises(HTTPException) as exc:
        _serve_media_reference(str(tmp_path / "missing.jpg"), "image/jpeg")

    assert exc.value.status_code == 410
