import json
import os
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AnalysisJob, Match, VideoAsset

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads"))
SESSION_DIR = Path(os.getenv("UPLOAD_SESSION_DIR", "upload_sessions"))
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(20 * 1024 * 1024 * 1024)))
MAX_CHUNK_BYTES = int(os.getenv("MAX_CHUNK_BYTES", str(16 * 1024 * 1024)))
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".m4v"}

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
SESSION_DIR.mkdir(parents=True, exist_ok=True)


class UploadSessionCreate(BaseModel):
    match_id: int
    filename: str = Field(min_length=1, max_length=255)
    content_type: str | None = None
    size_bytes: int = Field(gt=0)
    chunk_size: int = Field(gt=0, le=MAX_CHUNK_BYTES)


class UploadSessionRead(BaseModel):
    upload_id: str
    match_id: int
    filename: str
    size_bytes: int
    chunk_size: int
    total_chunks: int
    uploaded_chunks: list[int]
    completed: bool = False
    video_asset_id: int | None = None
    analysis_job_id: int | None = None


def _session_path(upload_id: str) -> Path:
    if not upload_id or any(char not in "0123456789abcdef-" for char in upload_id.lower()):
        raise HTTPException(status_code=400, detail="Invalid upload session id.")
    return SESSION_DIR / upload_id


def _metadata_path(upload_id: str) -> Path:
    return _session_path(upload_id) / "metadata.json"


def _read_metadata(upload_id: str) -> dict:
    path = _metadata_path(upload_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Upload session not found.")
    return json.loads(path.read_text(encoding="utf-8"))


def _write_metadata(upload_id: str, metadata: dict) -> None:
    _metadata_path(upload_id).write_text(json.dumps(metadata, indent=2), encoding="utf-8")


def _response(metadata: dict) -> UploadSessionRead:
    return UploadSessionRead(**metadata)


@router.post("", response_model=UploadSessionRead, status_code=status.HTTP_201_CREATED)
def create_upload_session(payload: UploadSessionCreate, db: Session = Depends(get_db)) -> UploadSessionRead:
    if db.get(Match, payload.match_id) is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    extension = Path(payload.filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported video type. Use MP4, MOV, AVI, MKV, or M4V.")
    if payload.size_bytes > MAX_UPLOAD_BYTES:
        limit_gb = MAX_UPLOAD_BYTES / (1024 ** 3)
        raise HTTPException(status_code=413, detail=f"Video exceeds the {limit_gb:g} GB upload limit.")

    upload_id = str(uuid.uuid4())
    session_path = _session_path(upload_id)
    session_path.mkdir(parents=True)
    total_chunks = (payload.size_bytes + payload.chunk_size - 1) // payload.chunk_size
    metadata = {
        "upload_id": upload_id,
        "match_id": payload.match_id,
        "filename": Path(payload.filename).name,
        "content_type": payload.content_type,
        "size_bytes": payload.size_bytes,
        "chunk_size": payload.chunk_size,
        "total_chunks": total_chunks,
        "uploaded_chunks": [],
        "completed": False,
        "video_asset_id": None,
        "analysis_job_id": None,
    }
    _write_metadata(upload_id, metadata)
    return _response(metadata)


@router.get("/{upload_id}", response_model=UploadSessionRead)
def get_upload_session(upload_id: str) -> UploadSessionRead:
    return _response(_read_metadata(upload_id))


@router.put("/{upload_id}/chunks/{chunk_index}", response_model=UploadSessionRead)
async def upload_chunk(upload_id: str, chunk_index: int, request: Request) -> UploadSessionRead:
    metadata = _read_metadata(upload_id)
    if metadata["completed"]:
        return _response(metadata)
    if chunk_index < 0 or chunk_index >= metadata["total_chunks"]:
        raise HTTPException(status_code=400, detail="Chunk index is outside the upload range.")

    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Chunk is empty.")
    if len(body) > metadata["chunk_size"] or len(body) > MAX_CHUNK_BYTES:
        raise HTTPException(status_code=413, detail="Chunk is larger than the configured chunk size.")

    expected_size = metadata["chunk_size"]
    if chunk_index == metadata["total_chunks"] - 1:
        expected_size = metadata["size_bytes"] - metadata["chunk_size"] * chunk_index
    if len(body) != expected_size:
        raise HTTPException(status_code=400, detail=f"Chunk size mismatch: expected {expected_size} bytes, received {len(body)}.")

    chunk_path = _session_path(upload_id) / f"chunk-{chunk_index:08d}.part"
    temporary_path = chunk_path.with_suffix(".tmp")
    temporary_path.write_bytes(body)
    temporary_path.replace(chunk_path)

    uploaded = set(metadata["uploaded_chunks"])
    uploaded.add(chunk_index)
    metadata["uploaded_chunks"] = sorted(uploaded)
    _write_metadata(upload_id, metadata)
    return _response(metadata)


@router.post("/{upload_id}/complete", response_model=UploadSessionRead)
def complete_upload(upload_id: str, db: Session = Depends(get_db)) -> UploadSessionRead:
    metadata = _read_metadata(upload_id)
    if metadata["completed"]:
        return _response(metadata)
    expected_chunks = set(range(metadata["total_chunks"]))
    if set(metadata["uploaded_chunks"]) != expected_chunks:
        missing = sorted(expected_chunks - set(metadata["uploaded_chunks"]))
        raise HTTPException(status_code=409, detail=f"Upload is incomplete. Missing chunks: {missing[:10]}")

    stored_filename = f"{uuid.uuid4().hex}{Path(metadata['filename']).suffix.lower()}"
    destination = UPLOAD_DIR / stored_filename
    temporary_destination = destination.with_suffix(destination.suffix + ".assembling")
    with temporary_destination.open("wb") as output:
        for index in range(metadata["total_chunks"]):
            chunk_path = _session_path(upload_id) / f"chunk-{index:08d}.part"
            with chunk_path.open("rb") as chunk:
                shutil.copyfileobj(chunk, output, length=4 * 1024 * 1024)

    if temporary_destination.stat().st_size != metadata["size_bytes"]:
        temporary_destination.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Assembled video size does not match the original file.")
    temporary_destination.replace(destination)

    video = VideoAsset(
        match_id=metadata["match_id"],
        original_filename=metadata["filename"],
        stored_filename=stored_filename,
        content_type=metadata.get("content_type"),
        size_bytes=metadata["size_bytes"],
        storage_path=str(destination),
    )
    db.add(video)
    db.flush()
    job = AnalysisJob(match_id=metadata["match_id"], video_asset_id=video.id, message="Full match uploaded and queued for processing")
    db.add(job)
    db.commit()
    db.refresh(video)
    db.refresh(job)

    metadata["completed"] = True
    metadata["video_asset_id"] = video.id
    metadata["analysis_job_id"] = job.id
    _write_metadata(upload_id, metadata)
    for chunk_file in _session_path(upload_id).glob("*.part"):
        chunk_file.unlink(missing_ok=True)
    return _response(metadata)


@router.delete("/{upload_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_upload(upload_id: str) -> None:
    session_path = _session_path(upload_id)
    if session_path.exists():
        shutil.rmtree(session_path)
