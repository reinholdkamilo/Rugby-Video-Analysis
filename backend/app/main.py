import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401
from app.api.routes import router as api_router
from app.database import Base, engine

APP_NAME = "Rugby Video Analysis API"
APP_VERSION = "0.2.0"


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


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


@app.get("/")
def root() -> dict[str, str]:
    return {"name": APP_NAME, "version": APP_VERSION, "status": "running"}


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "healthy", "service": "backend"}
