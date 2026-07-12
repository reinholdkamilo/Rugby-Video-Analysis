import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

APP_NAME = "Rugby Video Analysis API"
APP_VERSION = "0.1.0"

app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="Backend API for the Rugby Video Analysis platform.",
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


@app.get("/")
def root() -> dict[str, str]:
    return {"name": APP_NAME, "version": APP_VERSION, "status": "running"}


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "healthy", "service": "backend"}
