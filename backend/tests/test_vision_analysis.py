from pathlib import Path
from types import SimpleNamespace

import numpy as np

from app.api.vision import _vision_source
from app.vision_analysis import _extract_frame_with_ffmpeg, _sample_timestamps


def test_vision_source_uses_presigned_r2_url(monkeypatch) -> None:
    monkeypatch.setattr("app.api.vision.create_presigned_get_url", lambda *_args, **_kwargs: "https://r2.example.test/video.mp4")
    monkeypatch.setattr(
        "app.api.vision.materialize",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("R2 vision source should not be materialized")),
    )

    source = _vision_source(SimpleNamespace(storage_path="r2://rugby-video-analysis/source-videos/match.mp4"))

    assert source == "https://r2.example.test/video.mp4"


def test_sample_timestamps_spread_across_long_video() -> None:
    timestamps = _sample_timestamps(duration=3600.0, interval_seconds=30.0, max_frames=4)

    assert np.allclose(timestamps, np.array([0.0, 1199.667, 2399.333, 3599.0]), atol=0.001)


def test_extract_frame_uses_bounded_scaled_ffmpeg_command(tmp_path: Path, monkeypatch) -> None:
    output = tmp_path / "frame.jpg"
    calls: list[list[str]] = []

    def fake_run(command: list[str], **kwargs: object) -> SimpleNamespace:
        calls.append(command)
        assert kwargs["timeout"] == 20
        output.write_bytes(b"frame")
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr("app.vision_analysis.subprocess.run", fake_run)
    monkeypatch.setattr("app.vision_analysis.cv2.imread", lambda *_args: np.zeros((10, 10, 3), dtype=np.uint8))

    frame = _extract_frame_with_ffmpeg("https://r2.example.test/video.mp4", 12.5, output)

    command = calls[0]
    assert frame is not None
    assert command[command.index("-ss") + 1] == "12.500"
    assert command[command.index("-i") + 1] == "https://r2.example.test/video.mp4"
    assert "scale='min(640,iw)':-2" in command
