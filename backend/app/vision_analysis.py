import json
import os
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


def analyse_video_frames(video_path: str, video_asset_id: int, interval_seconds: float = 2.0, max_frames: int = 240) -> list[FrameObservation]:
    capture = cv2.VideoCapture(video_path)
    if not capture.isOpened():
        raise RuntimeError("OpenCV could not open the uploaded video.")

    fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    total_frames = capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    duration = total_frames / fps if total_frames else 0
    timestamps = np.arange(0.0, duration + 0.001, max(0.5, interval_seconds))[:max_frames]
    output_dir = VISION_DIR / f"video-{video_asset_id}"
    output_dir.mkdir(parents=True, exist_ok=True)

    observations: list[FrameObservation] = []
    previous_gray: np.ndarray | None = None
    for index, timestamp in enumerate(timestamps):
        capture.set(cv2.CAP_PROP_POS_MSEC, float(timestamp) * 1000.0)
        ok, frame = capture.read()
        if not ok:
            continue
        height, width = frame.shape[:2]
        if width > 1280:
            scale = 1280 / width
            frame = cv2.resize(frame, (1280, int(height * scale)))

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

        frame_name = f"frame-{index:05d}-{timestamp:.1f}.jpg"
        frame_path = output_dir / frame_name
        cv2.imwrite(str(frame_path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 86])
        observations.append(FrameObservation(
            timestamp_seconds=round(float(timestamp), 3),
            frame_path=str(frame_path),
            field_green_ratio=round(green_ratio, 4),
            field_visible=green_ratio >= 0.22,
            scoreboard_region=scoreboard_region,
            scoreboard_confidence=round(scoreboard_confidence, 4),
            brightness=round(brightness, 4),
            motion_score=round(motion, 4),
        ))
    capture.release()
    return observations
