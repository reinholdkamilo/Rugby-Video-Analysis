from pathlib import Path
from unittest.mock import Mock, patch

from app.clips import generate_event_clip


def test_generate_event_clip_builds_ffmpeg_command(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("app.clips.CLIP_DIR", tmp_path)
    source = tmp_path / "match.mp4"
    source.write_bytes(b"video")
    completed = Mock(returncode=0, stderr="")

    def fake_run(command: list[str], **_: object) -> Mock:
        Path(command[-1]).write_bytes(b"clip")
        return completed

    with patch("app.clips.subprocess.run", side_effect=fake_run) as run:
        path, duration = generate_event_clip(str(source), 12, 10.5, 18.0)

    assert path == str(tmp_path / "event-12.mp4")
    assert duration == 7.5
    command = run.call_args.args[0]
    assert command[0] == "ffmpeg"
    assert "10.500" in command
    assert "7.500" in command
    assert str(tmp_path / "event-12.mp4") == command[-1]


def test_generate_event_clip_uses_presigned_r2_source(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("app.clips.CLIP_DIR", tmp_path)
    monkeypatch.setattr("app.clips.persist_generated_file", lambda local_path, *_args: str(local_path))
    monkeypatch.setattr("app.clips.create_presigned_get_url", lambda *_args, **_kwargs: "https://r2.example.test/source.mp4")
    monkeypatch.setattr(
        "app.clips.materialize",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("R2 clips should not be materialized")),
    )

    def fake_run(command: list[str], **_: object) -> Mock:
        Path(command[-1]).write_bytes(b"clip")
        return Mock(returncode=0, stderr="")

    with patch("app.clips.subprocess.run", side_effect=fake_run) as run:
        path, duration = generate_event_clip("r2://rugby-video-analysis/source-videos/match.mp4", 12, 0, 8)

    command = run.call_args.args[0]
    assert path == str(tmp_path / "event-12.mp4")
    assert duration == 8
    assert command[command.index("-i") + 1] == "https://r2.example.test/source.mp4"
