import os
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.runtime_limits import max_local_upload_bytes

ALLOWED_VIDEO_TYPES = {
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-matroska",
}
MAX_UPLOAD_BYTES = max_local_upload_bytes()
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads"))


def save_video_upload(file: UploadFile) -> tuple[str, str, int]:
    if file.content_type not in ALLOWED_VIDEO_TYPES:
        raise ValueError("Unsupported video type. Upload MP4, MOV, AVI, or MKV footage.")

    suffix = Path(file.filename or "match-video.mp4").suffix.lower() or ".mp4"
    stored_filename = f"{uuid4().hex}{suffix}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    destination = UPLOAD_DIR / stored_filename

    size_bytes = 0
    with destination.open("wb") as output:
        while chunk := file.file.read(1024 * 1024):
            size_bytes += len(chunk)
            if size_bytes > MAX_UPLOAD_BYTES:
                destination.unlink(missing_ok=True)
                raise ValueError("Video exceeds the configured upload size limit.")
            output.write(chunk)

    return stored_filename, str(destination), size_bytes


def delete_stored_file(storage_path: str) -> None:
    Path(storage_path).unlink(missing_ok=True)
