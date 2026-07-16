import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from app.models import EventType

PTS_TIME_PATTERN = re.compile(r"pts_time:([0-9]+(?:\.[0-9]+)?)")
DEFAULT_SAMPLE_FPS = float(os.getenv("AUTO_DETECTION_SAMPLE_FPS", "0.5"))
DEFAULT_ANALYSIS_WIDTH = int(os.getenv("AUTO_DETECTION_ANALYSIS_WIDTH", "426"))
DEFAULT_MAX_SCAN_SECONDS = float(os.getenv("AUTO_DETECTION_MAX_SCAN_SECONDS", "120"))
DEFAULT_TIMEOUT_SECONDS = int(os.getenv("AUTO_DETECTION_TIMEOUT_SECONDS", "45"))


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


def build_scene_detection_command(
    source: str | Path,
    threshold: float,
    sample_fps: float = DEFAULT_SAMPLE_FPS,
    analysis_width: int = DEFAULT_ANALYSIS_WIDTH,
    max_scan_seconds: float = DEFAULT_MAX_SCAN_SECONDS,
) -> list[str]:
    filter_chain = (
        f"fps={sample_fps},"
        f"scale={analysis_width}:-2,"
        f"select='gt(scene,{threshold})',showinfo"
    )
    command = [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
    ]
    if max_scan_seconds > 0:
        command.extend(["-t", str(max_scan_seconds)])
    command.extend([
        "-i",
        str(source),
    ])
    command.extend(["-vf", filter_chain, "-an", "-f", "null", "-"])
    return command


def _is_remote_source(source: str) -> bool:
    return source.startswith(("http://", "https://"))


def detect_scene_changes(
    video_path: str,
    threshold: float = 0.28,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> list[float]:
    source: str | Path = video_path
    if not _is_remote_source(video_path):
        source = Path(video_path)

    if isinstance(source, Path) and not source.is_file():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    command = build_scene_detection_command(source, threshold)
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
