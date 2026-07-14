from app.object_storage import is_object_uri, object_uri, parse_object_uri


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
