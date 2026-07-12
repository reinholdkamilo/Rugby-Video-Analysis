import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from app.models import EventType

PTS_TIME_PATTERN = re.compile(r"pts_time:([0-9]+(?:\.[0-9]+)?)")


@dataclass(frozen=True)
class DetectionCandidate:
    event_type: EventType
    start_seconds: float
    end_seconds: float
    confidence: float
    label: str
    reason: str


def parse_scene_times(stderr: str) -> list[float]:
    """Parse FFmpeg showinfo timestamps and remove near-duplicate transitions."""
    times = sorted(float(value) for value in PTS_TIME_PATTERN.findall(stderr))
    deduplicated: list[float] = []
    for timestamp in times:
        if not deduplicated or timestamp - deduplicated[-1] >= 1.5:
            deduplicated.append(timestamp)
    return deduplicated


def detect_scene_changes(video_path: str, threshold: float = 0.28, timeout_seconds: int = 900) -> list[float]:
    source = Path(video_path)
    if not source.is_file():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    command = [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-i",
        str(source),
        "-vf",
        f"select='gt(scene,{threshold})',showinfo",
        "-an",
        "-f",
        "null",
        "-",
    ]
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=False,
    )
    if completed.returncode != 0:
        message = completed.stderr.strip().splitlines()[-1] if completed.stderr.strip() else "FFmpeg scene detection failed."
        raise RuntimeError(message)
    return parse_scene_times(completed.stderr)


def build_candidates(duration_seconds: float, scene_times: list[float]) -> list[DetectionCandidate]:
    """Convert visual transitions into conservative, reviewable rugby timeline suggestions."""
    if duration_seconds <= 0:
        return []

    candidates: list[DetectionCandidate] = [
        DetectionCandidate(
            event_type=EventType.kickoff,
            start_seconds=0.0,
            end_seconds=min(8.0, duration_seconds),
            confidence=0.58,
            label="Opening restart candidate",
            reason="The beginning of uploaded match footage is commonly a kick-off or restart. Confirm before accepting.",
        )
    ]

    for index, timestamp in enumerate(scene_times):
        if timestamp < 3 or timestamp >= duration_seconds - 1:
            continue
        previous = scene_times[index - 1] if index > 0 else 0.0
        gap = timestamp - previous
        start = max(0.0, timestamp - 3.0)
        end = min(duration_seconds, timestamp + 5.0)

        if gap >= 18.0:
            event_type = EventType.stoppage
            label = "Possible stoppage or set-piece reset"
            confidence = min(0.82, 0.55 + min(gap, 60.0) / 240.0)
            reason = f"A major camera transition followed approximately {gap:.1f} seconds after the previous transition."
        else:
            event_type = EventType.custom
            label = "Phase or camera transition"
            confidence = 0.48
            reason = "A strong visual scene change was detected. Review the surrounding footage and assign the correct rugby event."

        candidates.append(
            DetectionCandidate(
                event_type=event_type,
                start_seconds=round(start, 3),
                end_seconds=round(end, 3),
                confidence=round(confidence, 3),
                label=label,
                reason=reason,
            )
        )

    # Keep the review queue useful and bounded on long broadcasts.
    return candidates[:250]
