import os
import platform
import shutil
from datetime import UTC, datetime

from fastapi import APIRouter
from sqlalchemy import text

from app.database import engine

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


@router.get("")
def system_status() -> dict[str, object]:
    ffmpeg_path = shutil.which("ffmpeg")
    database = _database_status()
    opencv = _opencv_status()
    checks = {
        "api": {"healthy": True, "detail": "FastAPI is responding"},
        "database": database,
        "ffmpeg": {
            "healthy": ffmpeg_path is not None,
            "detail": ffmpeg_path or "FFmpeg executable not found",
        },
        "opencv": opencv,
    }
    overall_healthy = all(bool(item["healthy"]) for item in checks.values())

    return {
        "status": "healthy" if overall_healthy else "degraded",
        "checked_at": datetime.now(UTC).isoformat(),
        "version": os.getenv("APP_VERSION", "0.9.0"),
        "git_commit": os.getenv("RENDER_GIT_COMMIT", os.getenv("GIT_COMMIT", "local")),
        "environment": os.getenv("APP_ENV", "development"),
        "python": platform.python_version(),
        "checks": checks,
    }
