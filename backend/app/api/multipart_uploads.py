import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AnalysisJob, Match, MultipartUploadSession, VideoAsset
from app.object_storage import (
    abort_multipart_upload,
    complete_multipart_upload,
    create_multipart_upload,
    create_presigned_part_url,
    is_object_storage_enabled,
)
from app.rugby_analysis import evidence_for_video

router = APIRouter(prefix="/api/multipart-uploads", tags=["multipart-uploads"])

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(5 * 1024 * 1024 * 1024)))
PART_SIZE_BYTES = int(os.getenv("MULTIPART_PART_SIZE_BYTES", str(16 * 1024 * 1024)))
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".m4v"}


class MultipartCreate(BaseModel):
    match_id: int
    filename: str = Field(min_length=1, max_length=255)
    content_type: str | None = None
    size_bytes: int = Field(gt=0)


class CompletedPart(BaseModel):
    part_number: int = Field(ge=1, le=10000)
    etag: str = Field(min_length=1)


class MultipartCreateRead(BaseModel):
    upload_id: str
    object_key: str
    part_size: int
    total_parts: int
    uploaded_parts: list[CompletedPart] = Field(default_factory=list)
    resumed: bool = False


class PartUrlRead(BaseModel):
    part_number: int
    url: str


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


class MultipartPartRecord(BaseModel):
    object_key: str
    upload_id: str
    part: CompletedPart


def _validate_object_key(key: str) -> None:
    if not key.startswith("source-videos/") or ".." in key:
        raise HTTPException(status_code=400, detail="Invalid object key.")


def _session_response(session: MultipartUploadSession, resumed: bool = False) -> MultipartCreateRead:
    return MultipartCreateRead(
        upload_id=session.upload_id,
        object_key=session.object_key,
        part_size=session.part_size,
        total_parts=session.total_parts,
        uploaded_parts=[CompletedPart(**part) for part in session.uploaded_parts],
        resumed=resumed,
    )


def _get_upload_session(db: Session, object_key: str, upload_id: str) -> MultipartUploadSession:
    _validate_object_key(object_key)
    session = db.scalar(
        select(MultipartUploadSession).where(
            MultipartUploadSession.object_key == object_key,
            MultipartUploadSession.upload_id == upload_id,
        )
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Multipart upload session not found.")
    if session.status != "uploading":
        raise HTTPException(status_code=409, detail=f"Multipart upload session is {session.status}.")
    return session


@router.post("", response_model=MultipartCreateRead, status_code=status.HTTP_201_CREATED)
def create_upload(payload: MultipartCreate, db: Session = Depends(get_db)) -> MultipartCreateRead:
    if not is_object_storage_enabled():
        raise HTTPException(status_code=503, detail="Persistent object storage is not configured.")
    match = db.get(Match, payload.match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    extension = Path(payload.filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported video type. Use MP4, MOV, AVI, MKV, or M4V.")
    if payload.size_bytes > MAX_UPLOAD_BYTES:
        limit_gb = MAX_UPLOAD_BYTES / (1024 ** 3)
        raise HTTPException(status_code=413, detail=f"Video exceeds the {limit_gb:g} GB upload limit.")

    existing = db.scalar(
        select(MultipartUploadSession)
        .where(
            MultipartUploadSession.match_id == payload.match_id,
            MultipartUploadSession.filename == Path(payload.filename).name,
            MultipartUploadSession.size_bytes == payload.size_bytes,
            MultipartUploadSession.status == "uploading",
        )
        .order_by(MultipartUploadSession.updated_at.desc())
    )
    if existing is not None:
        return _session_response(existing, resumed=True)

    object_key = f"source-videos/{payload.match_id}/{uuid.uuid4().hex}{extension}"
    upload_id = create_multipart_upload(object_key, payload.content_type)
    total_parts = (payload.size_bytes + PART_SIZE_BYTES - 1) // PART_SIZE_BYTES
    session = MultipartUploadSession(
        match_id=payload.match_id,
        upload_id=upload_id,
        object_key=object_key,
        filename=Path(payload.filename).name,
        content_type=payload.content_type,
        size_bytes=payload.size_bytes,
        part_size=PART_SIZE_BYTES,
        total_parts=total_parts,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return _session_response(session)


@router.post("/parts", response_model=MultipartCreateRead)
def record_part(payload: MultipartPartRecord, db: Session = Depends(get_db)) -> MultipartCreateRead:
    session = _get_upload_session(db, payload.object_key, payload.upload_id)
    if payload.part.part_number > session.total_parts:
        raise HTTPException(status_code=400, detail="Part number exceeds upload part count.")
    parts = {
        int(part["part_number"]): {"part_number": int(part["part_number"]), "etag": str(part["etag"])}
        for part in session.uploaded_parts
    }
    parts[payload.part.part_number] = payload.part.model_dump()
    session.set_uploaded_parts(list(parts.values()))
    db.add(session)
    db.commit()
    db.refresh(session)
    return _session_response(session, resumed=True)


@router.get("/part-url", response_model=PartUrlRead)
def part_url(object_key: str, upload_id: str, part_number: int, db: Session = Depends(get_db)) -> PartUrlRead:
    session = _get_upload_session(db, object_key, upload_id)
    if part_number > session.total_parts:
        raise HTTPException(status_code=400, detail="Part number exceeds upload part count.")
    try:
        url = create_presigned_part_url(object_key, upload_id, part_number)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PartUrlRead(part_number=part_number, url=url)


@router.post("/complete", status_code=status.HTTP_201_CREATED)
def complete_upload(payload: MultipartComplete, db: Session = Depends(get_db)) -> dict[str, int | str]:
    match = db.get(Match, payload.match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    session = _get_upload_session(db, payload.object_key, payload.upload_id)
    if session.match_id != payload.match_id:
        raise HTTPException(status_code=400, detail="Upload session does not belong to this match.")
    if session.filename != Path(payload.filename).name or session.size_bytes != payload.size_bytes:
        raise HTTPException(status_code=400, detail="Upload session does not match the selected file.")

    incoming_parts = [part.model_dump() for part in payload.parts]
    if incoming_parts:
        parts = {
            int(part["part_number"]): {"part_number": int(part["part_number"]), "etag": str(part["etag"])}
            for part in session.uploaded_parts
        }
        for part in incoming_parts:
            parts[int(part["part_number"])] = part
        session.set_uploaded_parts(list(parts.values()))

    if len(session.uploaded_parts) != session.total_parts:
        raise HTTPException(status_code=400, detail="Not all uploaded parts have been recorded.")

    storage_path = complete_multipart_upload(
        payload.object_key,
        payload.upload_id,
        session.uploaded_parts,
    )
    video = VideoAsset(
        match_id=payload.match_id,
        sport_type=match.sport_type,
        original_filename=Path(payload.filename).name,
        stored_filename=Path(payload.object_key).name,
        content_type=payload.content_type,
        size_bytes=payload.size_bytes,
        storage_path=storage_path,
    )
    db.add(video)
    db.flush()
    db.add(evidence_for_video(video))
    job = AnalysisJob(
        match_id=payload.match_id,
        video_asset_id=video.id,
        message="Full match uploaded directly to persistent storage and queued for processing",
    )
    db.add(job)
    db.flush()
    session.status = "completed"
    session.video_asset_id = video.id
    session.analysis_job_id = job.id
    db.add(session)
    db.commit()
    db.refresh(video)
    db.refresh(job)
    return {"video_asset_id": video.id, "analysis_job_id": job.id, "storage_path": storage_path}


@router.post("/abort", status_code=status.HTTP_204_NO_CONTENT)
def abort_upload(payload: MultipartAbort, db: Session = Depends(get_db)) -> None:
    session = _get_upload_session(db, payload.object_key, payload.upload_id)
    abort_multipart_upload(payload.object_key, payload.upload_id)
    session.status = "aborted"
    db.add(session)
    db.commit()


@router.get("/{upload_id}", response_model=MultipartCreateRead)
def get_upload(upload_id: str, object_key: str, db: Session = Depends(get_db)) -> MultipartCreateRead:
    session = _get_upload_session(db, object_key, upload_id)
    return _session_response(session, resumed=True)
