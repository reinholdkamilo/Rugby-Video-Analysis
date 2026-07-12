import json
import subprocess
from pathlib import Path

from app import video_processing


def test_probe_video_parses_ffprobe_response(monkeypatch) -> None:
    payload = {
        "streams": [
            {
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "30000/1001",
                "duration": "90.5",
            },
            {"codec_type": "audio", "codec_name": "aac"},
        ],
        "format": {"duration": "90.5"},
    }

    def fake_run(command: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(command, 0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr(video_processing, "_run", fake_run)
    metadata = video_processing.probe_video("match.mp4")

    assert metadata.duration_seconds == 90.5
    assert metadata.width == 1920
    assert metadata.height == 1080
    assert metadata.frame_rate == 29.97
    assert metadata.video_codec == "h264"
    assert metadata.audio_codec == "aac"


def test_create_thumbnail_builds_expected_ffmpeg_command(monkeypatch, tmp_path: Path) -> None:
    captured: list[str] = []

    def fake_run(command: list[str]) -> subprocess.CompletedProcess[str]:
        captured.extend(command)
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(video_processing, "_run", fake_run)
    output = tmp_path / "thumbnails" / "video-1.jpg"

    result = video_processing.create_thumbnail("match.mp4", str(output), 400.0)

    assert result == str(output)
    assert output.parent.is_dir()
    assert captured[0] == "ffmpeg"
    assert captured[captured.index("-ss") + 1] == "30.000"
    assert captured[-1] == str(output)
