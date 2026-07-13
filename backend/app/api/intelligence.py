from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import RugbyUnderstandingObservation, VideoAsset
from app.rugby_intelligence import build_intelligence_report

router = APIRouter(prefix="/api/intelligence", tags=["rugby intelligence"])


@router.get("/report/{video_asset_id}")
def intelligence_report(video_asset_id: int, db: Session = Depends(get_db)) -> dict:
    video = db.get(VideoAsset, video_asset_id)
    if video is None:
        raise HTTPException(status_code=404, detail="Video not found.")

    observations = list(db.scalars(
        select(RugbyUnderstandingObservation)
        .where(RugbyUnderstandingObservation.video_asset_id == video_asset_id)
        .order_by(RugbyUnderstandingObservation.timestamp_seconds)
    ))
    try:
        return build_intelligence_report(observations)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
