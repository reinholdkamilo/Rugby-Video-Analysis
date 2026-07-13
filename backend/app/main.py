import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import models  # noqa: F401
from app.api.catalog import router as catalog_router
from app.api.events import router as events_router
from app.api.intelligence import router as intelligence_router
from app.api.media import router as media_router
from app.api.routes import router as api_router
from app.api.suggestions import router as suggestions_router
from app.api.system import router as system_router
from app.api.understanding import router as understanding_router
from app.api.uploads import router as uploads_router
from app.api.vision import router as vision_router
from app.api.workspace import router as workspace_router
from app.database import Base, engine
from app.worker import start_embedded_worker

logger = logging.getLogger("rugby-video-analysis")

APP_NAME = "Rugby Video Analysis API"
APP_VERSION = "0.11.0"
THUMBNAIL_DIR = Path(os.getenv("THUMBNAIL_DIR", "thumbnails"))
CLIP_DIR = Path(os.getenv("CLIP_DIR", "clips"))
VISION_FRAME_DIR = Path(os.getenv("VISION_FRAME_DIR", "vision_frames"))
THUMBNAIL_DIR.mkdir(parents=True, exist_ok=True)
CLIP_DIR.mkdir(parents=True, exist_ok=True)
VISION_FRAME_DIR.mkdir(parents=True, exist_ok=True)


def _configured_origins() -> list[str]:
    origins = {
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    }
    for value in (
        os.getenv("FRONTEND_URL", ""),
        os.getenv("ALLOWED_ORIGINS", ""),
    ):
        for origin in value.split(","):
            cleaned = origin.strip().rstrip("/")
            if cleaned:
                origins.add(cleaned)
    return sorted(origins)


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    worker = None
    if os.getenv("ENABLE_EMBEDDED_WORKER", "true").lower() in {"1", "true", "yes"}:
        worker = start_embedded_worker()
    yield
    if worker is not None:
        thread, stop_event = worker
        stop_event.set()
        thread.join(timeout=5)


app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="Backend API for the Rugby Video Analysis platform.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_configured_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SAFE_DASHBOARD_READS = {
    "/api/organisations",
    "/api/teams",
    "/api/matches",
    "/api/analysis-jobs",
}


@app.middleware("http")
async def protect_dashboard_reads(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception:
        logger.exception("Dashboard read failed for %s", request.url.path)
        if request.method == "GET" and request.url.path in SAFE_DASHBOARD_READS:
            return JSONResponse(
                status_code=200,
                content=[],
                headers={"X-Rugby-Recovered-Error": "true"},
            )
        raise


app.include_router(api_router)
app.include_router(catalog_router)
app.include_router(events_router)
app.include_router(media_router)
app.include_router(uploads_router)
app.include_router(suggestions_router)
app.include_router(vision_router)
app.include_router(understanding_router)
app.include_router(intelligence_router)
app.include_router(workspace_router)
app.include_router(system_router)
app.mount("/media/thumbnails", StaticFiles(directory=str(THUMBNAIL_DIR)), name="thumbnails")
app.mount("/media/clips", StaticFiles(directory=str(CLIP_DIR)), name="clips")
app.mount("/media/vision", StaticFiles(directory=str(VISION_FRAME_DIR)), name="vision")


@app.get("/")
def root() -> dict[str, str]:
    return {"name": APP_NAME, "version": APP_VERSION, "status": "running"}


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "healthy", "service": "backend"}
