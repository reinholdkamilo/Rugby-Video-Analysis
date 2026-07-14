from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, RedirectResponse, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import VideoAsset
from app.object_storage import create_presigned_get_url, is_object_uri

router = APIRouter(prefix="/api/videos", tags=["media"])


@router.get("/{video_asset_id}/stream", response_model=None)
def stream_video(video_asset_id: int, db: Session = Depends(get_db)) -> Response:
    video = db.get(VideoAsset, video_asset_id)
    if video is None:
        raise HTTPException(status_code=404, detail="Video not found.")

    if is_object_uri(video.storage_path):
        try:
            return RedirectResponse(
                url=create_presigned_get_url(video.storage_path),
                status_code=307,
                headers={"Cache-Control": "private, max-age=0, must-revalidate"},
            )
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail=f"Persistent video storage is temporarily unavailable: {str(exc)[:250]}",
            ) from exc

    source = Path(video.storage_path)
    if not source.is_file():
        raise HTTPException(
            status_code=410,
            detail="The source video is no longer available on this temporary environment.",
        )

    return FileResponse(
        path=source,
        media_type=video.content_type or "video/mp4",
        filename=video.original_filename,
        content_disposition_type="inline",
        headers={"Cache-Control": "private, max-age=0, must-revalidate"},
    )
