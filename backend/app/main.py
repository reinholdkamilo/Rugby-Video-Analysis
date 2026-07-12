import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import models  # noqa: F401
from app.api.events import router as events_router
from app.api.routes import router as api_router
from app.api.suggestions import router as suggestions_router
from app.api.uploads import router as uploads_router
from app.api.vision import router as vision_router
from app.database import Base, engine
from app.worker import start_embedded_worker

APP_NAME = "Rugby Video Analysis API"
APP_VERSION = "0.7.0"
THUMBNAIL_DIR = Path(os.getenv("THUMBNAIL_DIR", "thumbnails"))
CLIP_DIR = Path(os.getenv("CLIP_DIR", "clips"))
VISION_FRAME_DIR = Path(os.getenv("VISION_FRAME_DIR", "vision_frames"))
THUMBNAIL_DIR.mkdir(parents=True, exist_ok=True)
CLIP_DIR.mkdir(parents=True, exist_ok=True)
VISION_FRAME_DIR.mkdir(parents=True, exist_ok=True)


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

frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
allowed_origins = {
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    frontend_url,
}

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(allowed_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router)
app.include_router(events_router)
app.include_router(uploads_router)
app.include_router(suggestions_router)
app.include_router(vision_router)
app.mount("/media/thumbnails", StaticFiles(directory=str(THUMBNAIL_DIR)), name="thumbnails")
app.mount("/media/clips", StaticFiles(directory=str(CLIP_DIR)), name="clips")
app.mount("/media/vision", StaticFiles(directory=str(VISION_FRAME_DIR)), name="vision")


@app.get("/")
def root() -> dict[str, str]:
    return {"name": APP_NAME, "version": APP_VERSION, "status": "running"}


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "healthy", "service": "backend"}
