import os

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import VideoAsset, VisionFrameObservation
from app.object_storage import create_presigned_get_url, is_object_uri, materialize, persist_generated_file
from app.vision_analysis import analyse_video_frames

router = APIRouter(prefix="/api/vision", tags=["vision"])
MAX_VISION_FRAMES = int(os.getenv("MAX_VISION_FRAMES", "12"))
MIN_VISION_INTERVAL_SECONDS = float(os.getenv("MIN_VISION_INTERVAL_SECONDS", "30"))


class VisionRunRequest(BaseModel):
    video_asset_id: int
    interval_seconds: float = Field(default=30.0, ge=0.5, le=120.0)
    max_frames: int = Field(default=240, ge=1, le=1000)
    replace_existing: bool = True


class VisionObservationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    match_id: int
    video_asset_id: int
    timestamp_seconds: float
    frame_path: str
    field_green_ratio: float
    field_visible: bool
    scoreboard_region: str | None
    scoreboard_confidence: float
    brightness: float
    motion_score: float


def _vision_source(video: VideoAsset) -> str:
    if is_object_uri(video.storage_path):
        return create_presigned_get_url(video.storage_path, expires_in=7200)
    return str(materialize(video.storage_path))


@router.post("/run", response_model=list[VisionObservationRead], status_code=status.HTTP_201_CREATED)
def run_vision(payload: VisionRunRequest, db: Session = Depends(get_db)) -> list[VisionFrameObservation]:
    video = db.get(VideoAsset, payload.video_asset_id)
    if video is None:
        raise HTTPException(status_code=404, detail="Video not found.")

    if payload.replace_existing:
        db.execute(delete(VisionFrameObservation).where(VisionFrameObservation.video_asset_id == video.id))
        db.commit()

    try:
        source = _vision_source(video)
        analysed = analyse_video_frames(
            source,
            video.id,
            interval_seconds=max(payload.interval_seconds, MIN_VISION_INTERVAL_SECONDS),
            max_frames=min(payload.max_frames, MAX_VISION_FRAMES),
        )
        for observation in analysed:
            frame_name = observation.frame_path.rsplit("/", maxsplit=1)[-1]
            observation.frame_path = persist_generated_file(
                observation.frame_path,
                f"vision_frames/video-{video.id}/{frame_name}",
                "image/jpeg",
            )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Uploaded video file is unavailable.") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=f"Vision analysis failed: {exc}") from exc

    records = [
        VisionFrameObservation(
            match_id=video.match_id,
            video_asset_id=video.id,
            **observation.__dict__,
        )
        for observation in analysed
    ]
    db.add_all(records)
    db.commit()
    for record in records:
        db.refresh(record)
    return records


@router.get("/observations", response_model=list[VisionObservationRead])
def list_observations(video_asset_id: int, db: Session = Depends(get_db)) -> list[VisionFrameObservation]:
    statement = (
        select(VisionFrameObservation)
        .where(VisionFrameObservation.video_asset_id == video_asset_id)
        .order_by(VisionFrameObservation.timestamp_seconds)
    )
    return list(db.scalars(statement))
