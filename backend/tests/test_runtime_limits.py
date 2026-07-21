from app import runtime_limits


def test_hosted_runtime_uses_local_upload_budget_separate_from_multipart_limit(monkeypatch) -> None:
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("MAX_UPLOAD_BYTES", str(5 * 1024 * 1024 * 1024))
    monkeypatch.delenv("MAX_LOCAL_UPLOAD_BYTES", raising=False)
    monkeypatch.delenv("HOSTED_MAX_LOCAL_UPLOAD_BYTES", raising=False)

    assert runtime_limits.max_local_upload_bytes() == 250 * 1024 * 1024


def test_embedded_worker_defaults_off_on_hosted_runtime(monkeypatch) -> None:
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.delenv("ENABLE_EMBEDDED_WORKER", raising=False)

    assert runtime_limits.embedded_worker_enabled() is False


def test_embedded_worker_can_be_explicitly_enabled(monkeypatch) -> None:
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("ENABLE_EMBEDDED_WORKER", "true")

    assert runtime_limits.embedded_worker_enabled() is True
