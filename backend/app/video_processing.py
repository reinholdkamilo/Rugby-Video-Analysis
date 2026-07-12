import json
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class VideoMetadata:
    duration_seconds: float
    width: int
    height: int
    frame_rate: float
    video_codec: str | None
    audio_codec: str | None


def _run(command: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("FFmpeg is not installed or available on PATH.") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip() or exc.stdout.strip() or "Unknown FFmpeg error."
        raise RuntimeError(detail) from exc


def _parse_frame_rate(value: str | None) -> float:
    if not value or value == "0/0":
        return 0.0
    numerator, denominator = value.split("/", maxsplit=1)
    denominator_value = float(denominator)
    return float(numerator) / denominator_value if denominator_value else 0.0


def probe_video(video_path: str) -> VideoMetadata:
    result = _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            video_path,
        ]
    )
    payload = json.loads(result.stdout)
    streams = payload.get("streams", [])
    video_stream = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio_stream = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    if video_stream is None:
        raise RuntimeError("The uploaded file does not contain a readable video stream.")

    duration = video_stream.get("duration") or payload.get("format", {}).get("duration") or 0
    return VideoMetadata(
        duration_seconds=round(float(duration), 3),
        width=int(video_stream.get("width") or 0),
        height=int(video_stream.get("height") or 0),
        frame_rate=round(_parse_frame_rate(video_stream.get("avg_frame_rate")), 3),
        video_codec=video_stream.get("codec_name"),
        audio_codec=audio_stream.get("codec_name") if audio_stream else None,
    )


def create_thumbnail(video_path: str, output_path: str, duration_seconds: float) -> str:
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    seek_seconds = max(0.0, min(duration_seconds * 0.1, 30.0))
    _run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{seek_seconds:.3f}",
            "-i",
            video_path,
            "-frames:v",
            "1",
            "-vf",
            "scale=960:-2",
            "-q:v",
            "3",
            str(destination),
        ]
    )
    return str(destination)
