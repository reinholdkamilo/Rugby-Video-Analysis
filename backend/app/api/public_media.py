from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, RedirectResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import EventClip, RugbyUnderstandingObservation, VideoProcessingResult, VisionFrameObservation
from app.object_storage import create_presigned_get_url, is_object_uri

router = APIRouter(prefix="/media", tags=["public media"])


def _serve_media_reference(reference: str, media_type: str) -> Response:
    if is_object_uri(reference):
        try:
            return RedirectResponse(
                url=create_presigned_get_url(reference),
                status_code=307,
                headers={"Cache-Control": "private, max-age=0, must-revalidate"},
            )
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail=f"Persistent media storage is temporarily unavailable: {str(exc)[:250]}",
            ) from exc

    source = Path(reference)
    if not source.is_file():
        raise HTTPException(status_code=410, detail="Media file is no longer available.")
    return FileResponse(
        path=source,
        media_type=media_type,
        content_disposition_type="inline",
        headers={"Cache-Control": "private, max-age=0, must-revalidate"},
    )


@router.get("/thumbnails/{asset_name:path}", response_model=None)
def serve_thumbnail(asset_name: str, db: Session = Depends(get_db)) -> Response:
    result = db.scalar(
        select(VideoProcessingResult).where(VideoProcessingResult.thumbnail_path.endswith(asset_name))
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Thumbnail not found.")
    return _serve_media_reference(result.thumbnail_path, "image/jpeg")


@router.get("/clips/{asset_name:path}", response_model=None)
def serve_clip(asset_name: str, db: Session = Depends(get_db)) -> Response:
    clip = db.scalar(select(EventClip).where(EventClip.file_path.endswith(asset_name)))
    if clip is None:
        raise HTTPException(status_code=404, detail="Clip not found.")
    return _serve_media_reference(clip.file_path, "video/mp4")


@router.get("/vision/{asset_path:path}", response_model=None)
def serve_vision_frame(asset_path: str, db: Session = Depends(get_db)) -> Response:
    observation = db.scalar(
        select(VisionFrameObservation).where(VisionFrameObservation.frame_path.endswith(asset_path))
    )
    if observation is not None:
        return _serve_media_reference(observation.frame_path, "image/jpeg")

    understanding = db.scalar(
        select(RugbyUnderstandingObservation).where(
            RugbyUnderstandingObservation.source_frame_path.endswith(asset_path)
        )
    )
    if understanding is None:
        raise HTTPException(status_code=404, detail="Vision frame not found.")
    return _serve_media_reference(understanding.source_frame_path, "image/jpeg")
