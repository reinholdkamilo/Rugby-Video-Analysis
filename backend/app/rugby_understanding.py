from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass
class UnderstandingResult:
    timestamp_seconds: float
    estimated_players: int
    dominant_team_colour_1: str | None
    dominant_team_colour_2: str | None
    field_zone: str
    activity_level: float
    possession_side_candidate: str
    confidence: float
    source_frame_path: str


def _hex_colour(bgr: np.ndarray) -> str:
    b, g, r = [int(value) for value in bgr]
    return f"#{r:02x}{g:02x}{b:02x}"


def _team_colours(frame: np.ndarray, green_mask: np.ndarray) -> tuple[str | None, str | None]:
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    candidate_mask = (green_mask == 0) & (saturation > 70) & (value > 45)
    pixels = frame[candidate_mask]
    if len(pixels) < 100:
        return None, None
    sample = pixels[:: max(1, len(pixels) // 4000)].astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 1.0)
    _, labels, centres = cv2.kmeans(sample, 2, None, criteria, 5, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(labels.flatten(), minlength=2)
    order = np.argsort(counts)[::-1]
    return _hex_colour(centres[order[0]]), _hex_colour(centres[order[1]])


def _player_regions(frame: np.ndarray, green_mask: np.ndarray) -> tuple[int, str]:
    foreground = cv2.bitwise_not(green_mask)
    foreground[: int(frame.shape[0] * 0.12), :] = 0
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    contours, _ = cv2.findContours(foreground, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    centres: list[tuple[int, int]] = []
    frame_area = frame.shape[0] * frame.shape[1]
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < frame_area * 0.00008 or area > frame_area * 0.02:
            continue
        x, y, w, h = cv2.boundingRect(contour)
        if h < w * 0.7:
            continue
        centres.append((x + w // 2, y + h // 2))
    if not centres:
        return 0, "unknown"
    mean_x = sum(point[0] for point in centres) / len(centres)
    third = frame.shape[1] / 3
    side = "left" if mean_x < third else "right" if mean_x > third * 2 else "centre"
    return min(len(centres), 40), side


def analyse_understanding_frame(frame_path: str, timestamp_seconds: float, motion_score: float) -> UnderstandingResult:
    frame = cv2.imread(frame_path)
    if frame is None:
        raise RuntimeError(f"Unable to read sampled frame: {frame_path}")
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    green_mask = cv2.inRange(hsv, np.array([28, 35, 25]), np.array([95, 255, 255]))
    estimated_players, possession_side = _player_regions(frame, green_mask)
    colour_1, colour_2 = _team_colours(frame, green_mask)
    field_ratio = float(np.count_nonzero(green_mask)) / float(green_mask.size or 1)
    field_zone = "wide-field" if field_ratio > 0.5 else "tight-field" if field_ratio > 0.22 else "off-field"
    confidence = min(0.9, 0.25 + field_ratio * 0.55 + min(estimated_players, 15) / 100)
    return UnderstandingResult(
        timestamp_seconds=timestamp_seconds,
        estimated_players=estimated_players,
        dominant_team_colour_1=colour_1,
        dominant_team_colour_2=colour_2,
        field_zone=field_zone,
        activity_level=round(float(motion_score), 4),
        possession_side_candidate=possession_side,
        confidence=round(confidence, 4),
        source_frame_path=str(Path(frame_path)),
    )
