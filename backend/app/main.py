import logging
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app import models  # noqa: F401
from app.api.catalog import router as catalog_router
from app.api.events import router as events_router
from app.api.intelligence import router as intelligence_router
from app.api.library import router as library_router
from app.api.media import router as media_router
from app.api.multipart_uploads import router as multipart_uploads_router
from app.api.pipeline import router as pipeline_router
from app.api.public_media import router as public_media_router
from app.api.reports import router as reports_router
from app.api.routes import router as api_router
from app.api.suggestions import router as suggestions_router
from app.api.system import router as system_router
from app.api.understanding import router as understanding_router
from app.api.uploads import router as uploads_router
from app.api.vision import router as vision_router
from app.api.workspace import router as workspace_router
from app.database import Base, engine
from app.runtime_limits import embedded_worker_enabled
from app.worker import start_embedded_worker

logger = logging.getLogger("rugby-video-analysis")

APP_NAME = "Rugby Video Analysis API"
APP_VERSION = "0.12.0"
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


def _ensure_database_schema() -> None:
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        if engine.dialect.name == "postgresql":
            connection.execute(text("ALTER TABLE video_assets ALTER COLUMN size_bytes TYPE BIGINT"))
            connection.execute(text("ALTER TABLE multipart_upload_sessions ALTER COLUMN size_bytes TYPE BIGINT"))
            connection.execute(text("ALTER TABLE matches ADD COLUMN IF NOT EXISTS sport_type VARCHAR(40) DEFAULT 'rugby_union'"))
            connection.execute(text("ALTER TABLE video_assets ADD COLUMN IF NOT EXISTS sport_type VARCHAR(40) DEFAULT 'rugby_union'"))
            connection.execute(text("ALTER TABLE evidence_items ADD COLUMN IF NOT EXISTS sport_type VARCHAR(40) DEFAULT 'rugby_union'"))
            connection.execute(text("ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS event_source VARCHAR(40) DEFAULT 'manual'"))
            connection.execute(text("ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS trust_status VARCHAR(40) DEFAULT 'confirmed'"))
            connection.execute(text("ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS linked_event_id INTEGER REFERENCES timeline_events(id) ON DELETE SET NULL"))
            connection.execute(text("ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS linked_reason TEXT"))
            connection.execute(text("ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION"))
            connection.execute(text("ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS inference_rule VARCHAR(120)"))
            connection.execute(text("ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS created_from_event_ids TEXT"))
            connection.execute(text("ALTER TABLE evidence_items ADD COLUMN IF NOT EXISTS status VARCHAR(40) DEFAULT 'unconfirmed'"))
            connection.execute(text("ALTER TABLE evidence_items ADD COLUMN IF NOT EXISTS source VARCHAR(40) DEFAULT 'manual'"))
            connection.execute(text("ALTER TABLE evidence_items ADD COLUMN IF NOT EXISTS trust_notes TEXT"))
        elif engine.dialect.name == "sqlite":
            existing: dict[str, set[str]] = {}
            for table_name in ("matches", "video_assets", "timeline_events", "evidence_items"):
                rows = connection.execute(text(f"PRAGMA table_info({table_name})")).mappings()
                existing[table_name] = {str(row["name"]) for row in rows}
            sqlite_columns = {
                "matches": {
                    "sport_type": "VARCHAR(40) DEFAULT 'rugby_union'",
                },
                "video_assets": {
                    "sport_type": "VARCHAR(40) DEFAULT 'rugby_union'",
                },
                "timeline_events": {
                    "event_source": "VARCHAR(40) DEFAULT 'manual'",
                    "trust_status": "VARCHAR(40) DEFAULT 'confirmed'",
                    "linked_event_id": "INTEGER",
                    "linked_reason": "TEXT",
                    "confidence": "FLOAT",
                    "inference_rule": "VARCHAR(120)",
                    "created_from_event_ids": "TEXT",
                },
                "evidence_items": {
                    "sport_type": "VARCHAR(40) DEFAULT 'rugby_union'",
                    "status": "VARCHAR(40) DEFAULT 'unconfirmed'",
                    "source": "VARCHAR(40) DEFAULT 'manual'",
                    "trust_notes": "TEXT",
                },
            }
            for table_name, columns in sqlite_columns.items():
                for column_name, definition in columns.items():
                    if column_name not in existing[table_name]:
                        connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"))


@asynccontextmanager
async def lifespan(_: FastAPI):
    _ensure_database_schema()
    worker = None
    if embedded_worker_enabled():
        worker = start_embedded_worker()
    else:
        logger.info("Embedded video worker disabled for this runtime.")
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

PRIVATE_REALM = "Rugby Video Analysis Private API"
PUBLIC_PATHS = {"/", "/health", "/api/system/ready"}


def _hosted_private_mode() -> bool:
    configured = os.getenv("APP_PRIVATE_MODE", "").lower()
    return configured in {"1", "true", "yes", "on"}


def _private_api_response() -> JSONResponse:
    return JSONResponse(
        status_code=401,
        content={"detail": "Private workspace. Contact the owner for access."},
        headers={
            "WWW-Authenticate": f'Basic realm="{PRIVATE_REALM}", charset="UTF-8"',
            "Cache-Control": "no-store",
        },
    )


def _basic_auth_credentials(request: Request) -> tuple[str, str] | None:
    authorization = request.headers.get("authorization", "")
    if not authorization.startswith("Basic "):
        return None
    try:
        import base64

        decoded = base64.b64decode(authorization.removeprefix("Basic ")).decode("utf-8")
        username, password = decoded.split(":", 1)
        return username, password
    except Exception:
        return None


@app.middleware("http")
async def protect_private_api(request: Request, call_next):
    if request.method == "OPTIONS" or request.url.path in PUBLIC_PATHS or not _hosted_private_mode():
        return await call_next(request)
    expected_password = os.getenv("APP_ACCESS_PASSWORD")
    if not expected_password:
        return _private_api_response()
    expected_username = os.getenv("APP_ACCESS_USERNAME", "coach")
    credentials = _basic_auth_credentials(request)
    if credentials is not None:
        username, password = credentials
        if secrets.compare_digest(username, expected_username) and secrets.compare_digest(password, expected_password):
            return await call_next(request)
    return _private_api_response()


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
app.include_router(multipart_uploads_router)
app.include_router(pipeline_router)
app.include_router(suggestions_router)
app.include_router(vision_router)
app.include_router(understanding_router)
app.include_router(intelligence_router)
app.include_router(library_router)
app.include_router(workspace_router)
app.include_router(system_router)
app.include_router(public_media_router)
app.include_router(reports_router)
app.mount("/media/thumbnails", StaticFiles(directory=str(THUMBNAIL_DIR)), name="thumbnails")
app.mount("/media/clips", StaticFiles(directory=str(CLIP_DIR)), name="clips")
app.mount("/media/vision", StaticFiles(directory=str(VISION_FRAME_DIR)), name="vision")


@app.get("/")
def root() -> dict[str, str]:
    return {"name": APP_NAME, "version": APP_VERSION, "status": "running"}


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "healthy", "service": "backend"}
