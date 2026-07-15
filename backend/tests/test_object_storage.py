from pathlib import Path

from app.object_storage import is_object_uri, object_uri, parse_object_uri, persist_generated_file


def test_r2_object_uri_round_trip(monkeypatch):
    monkeypatch.setattr("app.object_storage.R2_BUCKET_NAME", "rugby-analysis-media")
    uri = object_uri("videos/match-12/example clip.mp4")

    assert is_object_uri(uri)
    assert parse_object_uri(uri) == (
        "rugby-analysis-media",
        "videos/match-12/example clip.mp4",
    )


def test_local_path_is_not_object_uri():
    assert not is_object_uri("/tmp/rugby-video-analysis/uploads/match.mp4")


def test_persist_generated_file_keeps_local_path_without_r2(monkeypatch, tmp_path: Path):
    local_file = tmp_path / "thumbnail.jpg"
    local_file.write_bytes(b"image")
    monkeypatch.setattr("app.object_storage.is_object_storage_enabled", lambda: False)

    assert persist_generated_file(local_file, "thumbnails/video-1.jpg", "image/jpeg") == str(local_file)


def test_persist_generated_file_uploads_when_r2_enabled(monkeypatch, tmp_path: Path):
    local_file = tmp_path / "event.mp4"
    local_file.write_bytes(b"clip")
    monkeypatch.setattr("app.object_storage.is_object_storage_enabled", lambda: True)

    uploaded: dict[str, object] = {}

    def fake_upload_file(source: Path, key: str, content_type: str | None = None) -> str:
        uploaded["source"] = source
        uploaded["key"] = key
        uploaded["content_type"] = content_type
        return "r2://bucket/clips/event-1.mp4"

    monkeypatch.setattr("app.object_storage.upload_file", fake_upload_file)

    assert persist_generated_file(local_file, "clips/event-1.mp4", "video/mp4") == "r2://bucket/clips/event-1.mp4"
    assert uploaded == {
        "source": local_file,
        "key": "clips/event-1.mp4",
        "content_type": "video/mp4",
    }
