import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

VISION_DIR = Path(os.getenv("VISION_FRAME_DIR", "vision_frames"))
VISION_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class FrameObservation:
    timestamp_seconds: float
    frame_path: str
    field_green_ratio: float
    field_visible: bool
    scoreboard_region: str | None
    scoreboard_confidence: float
    brightness: float
    motion_score: float


def _scoreboard_candidate(frame: np.ndarray) -> tuple[str | None, float]:
    height, width = frame.shape[:2]
    regions = {
        "top_left": frame[0:int(height * 0.28), 0:int(width * 0.48)],
        "top_right": frame[0:int(height * 0.28), int(width * 0.52):width],
    }
    best_name = None
    best_score = 0.0
    for name, region in regions.items():
        if region.size == 0:
            continue
        gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 70, 180)
        edge_density = float(np.count_nonzero(edges)) / float(edges.size or 1)
        contrast = float(gray.std()) / 128.0
        score = min(1.0, edge_density * 4.0 + contrast * 0.45)
        if score > best_score:
            best_name, best_score = name, score
    if best_score < 0.22:
        return None, best_score
    return json.dumps({"position": best_name}), best_score


def _probe_duration(video_path: str) -> float:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        video_path,
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=30, check=False)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "FFprobe could not read the video duration.")
    try:
        return float(completed.stdout.strip())
    except ValueError as exc:
        raise RuntimeError("FFprobe returned an invalid video duration.") from exc


def _extract_frame_with_ffmpeg(video_path: str, timestamp: float, output_path: Path) -> np.ndarray | None:
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{timestamp:.3f}",
        "-i",
        video_path,
        "-frames:v",
        "1",
        "-vf",
        "scale='min(1280,iw)':-2",
        "-q:v",
        "3",
        "-y",
        str(output_path),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=60, check=False)
    if completed.returncode != 0 or not output_path.is_file():
        return None
    return cv2.imread(str(output_path))


def analyse_video_frames(
    video_path: str,
    video_asset_id: int,
    interval_seconds: float = 2.0,
    max_frames: int = 240,
) -> list[FrameObservation]:
    capture = cv2.VideoCapture(video_path)
    capture_available = capture.isOpened()

    fps = capture.get(cv2.CAP_PROP_FPS) if capture_available else 0.0
    total_frames = capture.get(cv2.CAP_PROP_FRAME_COUNT) if capture_available else 0.0
    duration = total_frames / fps if fps and total_frames else _probe_duration(video_path)
    if duration <= 0:
        capture.release()
        raise RuntimeError("The uploaded video has no readable duration.")

    timestamps = np.arange(0.0, duration + 0.001, max(0.5, interval_seconds))[:max_frames]
    output_dir = VISION_DIR / f"video-{video_asset_id}"
    output_dir.mkdir(parents=True, exist_ok=True)

    observations: list[FrameObservation] = []
    previous_gray: np.ndarray | None = None
    failed_frames = 0

    for index, raw_timestamp in enumerate(timestamps):
        timestamp = float(raw_timestamp)
        frame_name = f"frame-{index:05d}-{timestamp:.1f}.jpg"
        frame_path = output_dir / frame_name
        frame: np.ndarray | None = None

        if capture_available:
            capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000.0)
            ok, decoded = capture.read()
            if ok and decoded is not None:
                frame = decoded

        if frame is None:
            frame = _extract_frame_with_ffmpeg(video_path, timestamp, frame_path)

        if frame is None:
            failed_frames += 1
            continue

        height, width = frame.shape[:2]
        if width > 1280:
            scale = 1280 / width
            frame = cv2.resize(frame, (1280, max(1, int(height * scale))))

        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        green_mask = cv2.inRange(hsv, np.array([28, 35, 25]), np.array([95, 255, 255]))
        green_ratio = float(np.count_nonzero(green_mask)) / float(green_mask.size or 1)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        brightness = float(gray.mean()) / 255.0
        motion = 0.0
        if previous_gray is not None:
            resized_previous = cv2.resize(previous_gray, (gray.shape[1], gray.shape[0]))
            motion = float(cv2.absdiff(gray, resized_previous).mean()) / 255.0
        previous_gray = gray
        scoreboard_region, scoreboard_confidence = _scoreboard_candidate(frame)

        if not frame_path.is_file():
            saved = cv2.imwrite(str(frame_path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 86])
            if not saved:
                failed_frames += 1
                continue

        observations.append(
            FrameObservation(
                timestamp_seconds=round(timestamp, 3),
                frame_path=str(frame_path),
                field_green_ratio=round(green_ratio, 4),
                field_visible=green_ratio >= 0.22,
                scoreboard_region=scoreboard_region,
                scoreboard_confidence=round(scoreboard_confidence, 4),
                brightness=round(brightness, 4),
                motion_score=round(motion, 4),
            )
        )

    capture.release()
    if not observations:
        raise RuntimeError(
            f"No frames could be decoded from the uploaded video. {failed_frames} frame extractions failed."
        )
    return observations
