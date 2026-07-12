from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import RugbyUnderstandingObservation, VideoAsset, VisionFrameObservation
from app.rugby_understanding import analyse_understanding_frame

router = APIRouter(prefix="/api/understanding", tags=["rugby understanding"])


class UnderstandingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    match_id: int
    video_asset_id: int
    timestamp_seconds: float
    estimated_players: int
    dominant_team_colour_1: str | None
    dominant_team_colour_2: str | None
    field_zone: str
    activity_level: float
    possession_side_candidate: str
    confidence: float
    source_frame_path: str


@router.post("/run/{video_asset_id}", response_model=list[UnderstandingRead], status_code=status.HTTP_201_CREATED)
def run_understanding(video_asset_id: int, db: Session = Depends(get_db)) -> list[RugbyUnderstandingObservation]:
    video = db.get(VideoAsset, video_asset_id)
    if video is None:
        raise HTTPException(status_code=404, detail="Video not found.")
    frames = list(db.scalars(
        select(VisionFrameObservation)
        .where(VisionFrameObservation.video_asset_id == video_asset_id)
        .order_by(VisionFrameObservation.timestamp_seconds)
    ))
    if not frames:
        raise HTTPException(status_code=409, detail="Run Stage 5 vision analysis before rugby understanding.")
    db.execute(delete(RugbyUnderstandingObservation).where(RugbyUnderstandingObservation.video_asset_id == video_asset_id))
    records: list[RugbyUnderstandingObservation] = []
    for frame in frames:
        result = analyse_understanding_frame(frame.frame_path, frame.timestamp_seconds, frame.motion_score)
        records.append(RugbyUnderstandingObservation(match_id=video.match_id, video_asset_id=video.id, **result.__dict__))
    db.add_all(records)
    db.commit()
    for record in records:
        db.refresh(record)
    return records


@router.get("/{video_asset_id}", response_model=list[UnderstandingRead])
def list_understanding(video_asset_id: int, db: Session = Depends(get_db)) -> list[RugbyUnderstandingObservation]:
    return list(db.scalars(
        select(RugbyUnderstandingObservation)
        .where(RugbyUnderstandingObservation.video_asset_id == video_asset_id)
        .order_by(RugbyUnderstandingObservation.timestamp_seconds)
    ))
