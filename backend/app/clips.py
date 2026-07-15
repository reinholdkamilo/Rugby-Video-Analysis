import os
import subprocess
from pathlib import Path

from app.object_storage import materialize, persist_generated_file

CLIP_DIR = Path(os.getenv("CLIP_DIR", "clips"))
CLIP_SOURCE_CACHE_DIR = Path(os.getenv("OBJECT_CACHE_DIR", "cache/object_storage")) / "clip_sources"


def generate_event_clip(source_path: str, event_id: int, start_seconds: float, end_seconds: float) -> tuple[str, float]:
    duration = end_seconds - start_seconds
    if duration <= 0:
        raise ValueError("Clip duration must be greater than zero.")

    source = materialize(source_path, CLIP_SOURCE_CACHE_DIR)
    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    output_path = CLIP_DIR / f"event-{event_id}.mp4"
    command = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start_seconds:.3f}",
        "-i",
        str(source),
        "-t",
        f"{duration:.3f}",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        str(output_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "FFmpeg could not generate the event clip.")
    stored_path = persist_generated_file(
        output_path,
        f"clips/event-{event_id}.mp4",
        "video/mp4",
    )
    return stored_path, duration
