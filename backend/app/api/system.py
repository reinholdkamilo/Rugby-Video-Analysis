import os
import platform
import shutil
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.database import engine
from app.object_storage import storage_status

router = APIRouter(prefix="/api/system", tags=["system"])


def _database_status() -> dict[str, str | bool]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"healthy": True, "detail": "Database connection successful"}
    except Exception as exc:  # pragma: no cover - exercised through deployed health checks
        return {"healthy": False, "detail": f"Database connection failed: {exc}"}


def _opencv_status() -> dict[str, str | bool]:
    try:
        import cv2

        return {"healthy": True, "detail": f"OpenCV {cv2.__version__}"}
    except Exception as exc:  # pragma: no cover
        return {"healthy": False, "detail": f"OpenCV unavailable: {exc}"}


def _storage_status() -> dict[str, str | bool]:
    directories = [
        Path(os.getenv("UPLOAD_DIR", "uploads")),
        Path(os.getenv("THUMBNAIL_DIR", "thumbnails")),
        Path(os.getenv("CLIP_DIR", "clips")),
        Path(os.getenv("VISION_FRAME_DIR", "vision_frames")),
    ]
    try:
        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)
            probe = directory / ".readiness-probe"
            probe.write_text("ready", encoding="utf-8")
            probe.unlink(missing_ok=True)
        return {"healthy": True, "detail": f"{len(directories)} media directories writable"}
    except OSError as exc:
        return {"healthy": False, "detail": f"Media storage unavailable: {exc}"}


def build_system_status() -> dict[str, object]:
    ffmpeg_path = shutil.which("ffmpeg")
    checks = {
        "api": {"healthy": True, "detail": "FastAPI is responding"},
        "database": _database_status(),
        "storage": _storage_status(),
        "ffmpeg": {
            "healthy": ffmpeg_path is not None,
            "detail": ffmpeg_path or "FFmpeg executable not found",
        },
        "opencv": _opencv_status(),
        "object_storage": storage_status(),
    }
    required_checks = {key: value for key, value in checks.items() if key != "object_storage"}
    overall_healthy = all(bool(item["healthy"]) for item in required_checks.values())
    return {
        "status": "healthy" if overall_healthy else "degraded",
        "checked_at": datetime.now(UTC).isoformat(),
        "version": os.getenv("APP_VERSION", "0.11.0"),
        "git_commit": os.getenv("RENDER_GIT_COMMIT", os.getenv("GIT_COMMIT", "local")),
        "environment": os.getenv("APP_ENV", "development"),
        "python": platform.python_version(),
        "checks": checks,
    }


@router.get("")
def system_status() -> dict[str, object]:
    return build_system_status()


@router.get("/ready")
def readiness_status():
    payload = build_system_status()
    return JSONResponse(status_code=200 if payload["status"] == "healthy" else 503, content=payload)
