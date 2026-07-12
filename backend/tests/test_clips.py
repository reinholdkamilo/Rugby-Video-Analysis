from pathlib import Path
from unittest.mock import Mock, patch

from app.clips import generate_event_clip


def test_generate_event_clip_builds_ffmpeg_command(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("app.clips.CLIP_DIR", tmp_path)
    completed = Mock(returncode=0, stderr="")

    with patch("app.clips.subprocess.run", return_value=completed) as run:
        path, duration = generate_event_clip("match.mp4", 12, 10.5, 18.0)

    assert path == str(tmp_path / "event-12.mp4")
    assert duration == 7.5
    command = run.call_args.args[0]
    assert command[0] == "ffmpeg"
    assert "10.500" in command
    assert "7.500" in command
    assert str(tmp_path / "event-12.mp4") == command[-1]
