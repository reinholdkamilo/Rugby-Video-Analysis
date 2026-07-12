import os
import subprocess
from pathlib import Path

CLIP_DIR = Path(os.getenv("CLIP_DIR", "clips"))


def generate_event_clip(source_path: str, event_id: int, start_seconds: float, end_seconds: float) -> tuple[str, float]:
    duration = end_seconds - start_seconds
    if duration <= 0:
        raise ValueError("Clip duration must be greater than zero.")

    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    output_path = CLIP_DIR / f"event-{event_id}.mp4"
    command = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start_seconds:.3f}",
        "-i",
        source_path,
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
    return str(output_path), duration
