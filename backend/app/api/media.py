from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import VideoAsset

router = APIRouter(prefix="/api/videos", tags=["media"])


@router.get("/{video_asset_id}/stream")
def stream_video(video_asset_id: int, db: Session = Depends(get_db)) -> FileResponse:
    video = db.get(VideoAsset, video_asset_id)
    if video is None:
        raise HTTPException(status_code=404, detail="Video not found.")

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
