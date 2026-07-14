import logging
import os
import threading
import time
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import AnalysisJob, AnalysisStatus, VideoAsset, VideoProcessingResult
from app.object_storage import create_presigned_get_url, is_object_uri
from app.video_processing import create_thumbnail, probe_video

logger = logging.getLogger(__name__)
POLL_INTERVAL_SECONDS = float(os.getenv("WORKER_POLL_INTERVAL_SECONDS", "3"))
THUMBNAIL_DIR = Path(os.getenv("THUMBNAIL_DIR", "thumbnails"))


def _update_job(db: Session, job: AnalysisJob, progress: int, message: str) -> None:
    job.progress_percent = progress
    job.message = message
    db.commit()


def _processing_source(storage_path: str) -> str:
    if is_object_uri(storage_path):
        return create_presigned_get_url(storage_path, expires_in=7200)
    if Path(storage_path).is_file():
        return storage_path
    raise FileNotFoundError(storage_path)


def process_job(db: Session, job: AnalysisJob) -> None:
    job.status = AnalysisStatus.processing
    _update_job(db, job, 10, "Preparing uploaded footage.")

    if job.video_asset_id is None:
        raise RuntimeError("Analysis job has no video attached.")

    video = db.get(VideoAsset, job.video_asset_id)
    if video is None:
        raise RuntimeError("The uploaded video record could not be found.")

    try:
        source = _processing_source(video.storage_path)
    except FileNotFoundError as exc:
        raise RuntimeError("The uploaded video file is missing from storage.") from exc

    _update_job(db, job, 30, "Reading video metadata with FFmpeg.")
    metadata = probe_video(source)

    _update_job(db, job, 65, "Generating match thumbnail.")
    thumbnail_path = THUMBNAIL_DIR / f"video-{video.id}.jpg"
    create_thumbnail(source, str(thumbnail_path), metadata.duration_seconds)

    _update_job(db, job, 85, "Saving processing results.")
    existing = db.scalar(
        select(VideoProcessingResult).where(VideoProcessingResult.analysis_job_id == job.id)
    )
    if existing is None:
        existing = VideoProcessingResult(
            analysis_job_id=job.id,
            video_asset_id=video.id,
            duration_seconds=metadata.duration_seconds,
            width=metadata.width,
            height=metadata.height,
            frame_rate=metadata.frame_rate,
            video_codec=metadata.video_codec,
            audio_codec=metadata.audio_codec,
            thumbnail_path=str(thumbnail_path),
        )
        db.add(existing)
    else:
        existing.duration_seconds = metadata.duration_seconds
        existing.width = metadata.width
        existing.height = metadata.height
        existing.frame_rate = metadata.frame_rate
        existing.video_codec = metadata.video_codec
        existing.audio_codec = metadata.audio_codec
        existing.thumbnail_path = str(thumbnail_path)

    job.status = AnalysisStatus.completed
    job.progress_percent = 100
    job.message = "Video preparation complete. Metadata and thumbnail are ready."
    db.commit()


def process_next_job() -> bool:
    with SessionLocal() as db:
        job = db.scalar(
            select(AnalysisJob)
            .where(AnalysisJob.status == AnalysisStatus.queued)
            .order_by(AnalysisJob.created_at, AnalysisJob.id)
            .limit(1)
        )
        if job is None:
            return False

        try:
            process_job(db, job)
        except Exception as exc:
            logger.exception("Analysis job %s failed", job.id)
            db.rollback()
            failed_job = db.get(AnalysisJob, job.id)
            if failed_job is not None:
                failed_job.status = AnalysisStatus.failed
                failed_job.message = str(exc)[:1000]
                db.commit()
        return True


def run_worker(stop_event: threading.Event | None = None) -> None:
    logger.info("Rugby Video Analysis worker started")
    while stop_event is None or not stop_event.is_set():
        processed = process_next_job()
        if not processed:
            if stop_event is not None:
                stop_event.wait(POLL_INTERVAL_SECONDS)
            else:
                time.sleep(POLL_INTERVAL_SECONDS)


def start_embedded_worker() -> tuple[threading.Thread, threading.Event]:
    stop_event = threading.Event()
    thread = threading.Thread(
        target=run_worker,
        args=(stop_event,),
        name="video-analysis-worker",
        daemon=True,
    )
    thread.start()
    return thread, stop_event


if __name__ == "__main__":
    run_worker()
