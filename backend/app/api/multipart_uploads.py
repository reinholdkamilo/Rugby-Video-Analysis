import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AnalysisJob, Match, VideoAsset
from app.object_storage import (
    abort_multipart_upload,
    complete_multipart_upload,
    create_multipart_upload,
    create_presigned_part_url,
    is_object_storage_enabled,
)

router = APIRouter(prefix="/api/multipart-uploads", tags=["multipart-uploads"])

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(5 * 1024 * 1024 * 1024)))
PART_SIZE_BYTES = int(os.getenv("MULTIPART_PART_SIZE_BYTES", str(16 * 1024 * 1024)))
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".m4v"}


class MultipartCreate(BaseModel):
    match_id: int
    filename: str = Field(min_length=1, max_length=255)
    content_type: str | None = None
    size_bytes: int = Field(gt=0)


class MultipartCreateRead(BaseModel):
    upload_id: str
    object_key: str
    part_size: int
    total_parts: int


class PartUrlRead(BaseModel):
    part_number: int
    url: str


class CompletedPart(BaseModel):
    part_number: int = Field(ge=1, le=10000)
    etag: str = Field(min_length=1)


class MultipartComplete(BaseModel):
    match_id: int
    filename: str
    content_type: str | None = None
    size_bytes: int = Field(gt=0)
    object_key: str
    upload_id: str
    parts: list[CompletedPart]


class MultipartAbort(BaseModel):
    object_key: str
    upload_id: str


def _validate_object_key(key: str) -> None:
    if not key.startswith("source-videos/") or ".." in key:
        raise HTTPException(status_code=400, detail="Invalid object key.")


@router.post("", response_model=MultipartCreateRead, status_code=status.HTTP_201_CREATED)
def create_upload(payload: MultipartCreate, db: Session = Depends(get_db)) -> MultipartCreateRead:
    if not is_object_storage_enabled():
        raise HTTPException(status_code=503, detail="Persistent object storage is not configured.")
    if db.get(Match, payload.match_id) is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    extension = Path(payload.filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported video type. Use MP4, MOV, AVI, MKV, or M4V.")
    if payload.size_bytes > MAX_UPLOAD_BYTES:
        limit_gb = MAX_UPLOAD_BYTES / (1024 ** 3)
        raise HTTPException(status_code=413, detail=f"Video exceeds the {limit_gb:g} GB upload limit.")

    object_key = f"source-videos/{payload.match_id}/{uuid.uuid4().hex}{extension}"
    upload_id = create_multipart_upload(object_key, payload.content_type)
    total_parts = (payload.size_bytes + PART_SIZE_BYTES - 1) // PART_SIZE_BYTES
    return MultipartCreateRead(
        upload_id=upload_id,
        object_key=object_key,
        part_size=PART_SIZE_BYTES,
        total_parts=total_parts,
    )


@router.get("/part-url", response_model=PartUrlRead)
def part_url(object_key: str, upload_id: str, part_number: int) -> PartUrlRead:
    _validate_object_key(object_key)
    try:
        url = create_presigned_part_url(object_key, upload_id, part_number)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PartUrlRead(part_number=part_number, url=url)


@router.post("/complete", status_code=status.HTTP_201_CREATED)
def complete_upload(payload: MultipartComplete, db: Session = Depends(get_db)) -> dict[str, int | str]:
    if db.get(Match, payload.match_id) is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    _validate_object_key(payload.object_key)
    if not payload.parts:
        raise HTTPException(status_code=400, detail="No uploaded parts were supplied.")

    storage_path = complete_multipart_upload(
        payload.object_key,
        payload.upload_id,
        [part.model_dump() for part in payload.parts],
    )
    video = VideoAsset(
        match_id=payload.match_id,
        original_filename=Path(payload.filename).name,
        stored_filename=Path(payload.object_key).name,
        content_type=payload.content_type,
        size_bytes=payload.size_bytes,
        storage_path=storage_path,
    )
    db.add(video)
    db.flush()
    job = AnalysisJob(
        match_id=payload.match_id,
        video_asset_id=video.id,
        message="Full match uploaded directly to persistent storage and queued for processing",
    )
    db.add(job)
    db.commit()
    db.refresh(video)
    db.refresh(job)
    return {"video_asset_id": video.id, "analysis_job_id": job.id, "storage_path": storage_path}


@router.post("/abort", status_code=status.HTTP_204_NO_CONTENT)
def abort_upload(payload: MultipartAbort) -> None:
    _validate_object_key(payload.object_key)
    abort_multipart_upload(payload.object_key, payload.upload_id)
