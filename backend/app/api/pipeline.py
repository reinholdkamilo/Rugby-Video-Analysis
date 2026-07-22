import logging
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.suggestions import DetectionRequest, _create_suggestions
from app.api.vision import VisionRunRequest, run_vision
from app.database import SessionLocal, get_db
from app.models import (
    AnalysisJob,
    AnalysisStatus,
    AutomaticEventSuggestion,
    EvidenceItem,
    Match,
    SuggestionStatus,
    TimelineEvent,
    VideoAsset,
    VideoProcessingResult,
    VisionFrameObservation,
)
from app.runtime_limits import runtime_diagnostics
from app.worker import process_job

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/matches", tags=["analysis pipeline"])

StageStatus = Literal["pending", "running", "done", "blocked", "failed"]


class PipelineRunRequest(BaseModel):
    video_asset_id: int | None = None
    run_vision: bool = True
    run_suggestions: bool = True


class PipelineStageRead(BaseModel):
    key: str
    label: str
    status: StageStatus
    progress_percent: int
    detail: str
    count: int | None = None


class PipelineStatusRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    match_id: int
    video_asset_id: int | None
    status: StageStatus
    progress_percent: int
    message: str
    active_job_id: int | None
    stages: list[PipelineStageRead]


def _latest_video(match_id: int, db: Session) -> VideoAsset | None:
    return db.scalar(
        select(VideoAsset)
        .where(VideoAsset.match_id == match_id)
        .order_by(VideoAsset.created_at.desc(), VideoAsset.id.desc())
        .limit(1)
    )


def _count(db: Session, statement) -> int:
    return int(db.scalar(select(func.count()).select_from(statement.subquery())) or 0)


def _active_job(match_id: int, video_asset_id: int | None, db: Session) -> AnalysisJob | None:
    statement = (
        select(AnalysisJob)
        .where(AnalysisJob.match_id == match_id)
        .where(AnalysisJob.status.in_([AnalysisStatus.queued, AnalysisStatus.processing]))
        .order_by(AnalysisJob.created_at.desc(), AnalysisJob.id.desc())
        .limit(1)
    )
    if video_asset_id is not None:
        statement = statement.where(AnalysisJob.video_asset_id == video_asset_id)
    return db.scalar(statement)


def _pipeline_status(match_id: int, db: Session, video_asset_id: int | None = None) -> PipelineStatusRead:
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found.")

    video = db.get(VideoAsset, video_asset_id) if video_asset_id is not None else _latest_video(match_id, db)
    if video is not None and video.match_id != match_id:
        raise HTTPException(status_code=422, detail="Video does not belong to this match.")

    active = _active_job(match_id, video.id if video else None, db)
    stages: list[PipelineStageRead] = []

    if video is None:
        stages.append(PipelineStageRead(key="upload", label="Upload video", status="pending", progress_percent=0, detail="No source video has been uploaded yet."))
        return PipelineStatusRead(
            match_id=match_id,
            video_asset_id=None,
            status="pending",
            progress_percent=0,
            message="Upload match footage to start the analysis pipeline.",
            active_job_id=active.id if active else None,
            stages=stages,
        )

    processing = db.scalar(select(VideoProcessingResult).where(VideoProcessingResult.video_asset_id == video.id))
    vision_count = _count(db, select(VisionFrameObservation.id).where(VisionFrameObservation.video_asset_id == video.id))
    suggestion_count = _count(db, select(AutomaticEventSuggestion.id).where(AutomaticEventSuggestion.video_asset_id == video.id))
    pending_suggestions = _count(
        db,
        select(AutomaticEventSuggestion.id).where(
            AutomaticEventSuggestion.video_asset_id == video.id,
            AutomaticEventSuggestion.status == SuggestionStatus.pending,
        ),
    )
    event_count = _count(db, select(TimelineEvent.id).where(TimelineEvent.video_asset_id == video.id))
    evidence_count = _count(db, select(EvidenceItem.id).where(EvidenceItem.video_asset_id == video.id))

    stages.append(PipelineStageRead(key="upload", label="Upload video", status="done", progress_percent=100, detail=f"{video.original_filename} is stored.", count=1))
    stages.append(
        PipelineStageRead(
            key="processing",
            label="Process video",
            status="done" if processing else ("running" if active else "pending"),
            progress_percent=100 if processing else (active.progress_percent if active else 0),
            detail="Metadata and thumbnail are ready." if processing else (active.message or "Waiting for video preparation."),
            count=1 if processing else 0,
        )
    )
    stages.append(
        PipelineStageRead(
            key="vision",
            label="Run vision",
            status="done" if vision_count else ("blocked" if processing is None else "pending"),
            progress_percent=100 if vision_count else 0,
            detail=f"{vision_count} sampled frames available." if vision_count else ("Video must be processed first." if processing is None else "Vision has not been run yet."),
            count=vision_count,
        )
    )
    stages.append(
        PipelineStageRead(
            key="suggestions",
            label="Generate suggestions",
            status="done" if suggestion_count else ("blocked" if processing is None else "pending"),
            progress_percent=100 if suggestion_count else 0,
            detail=f"{suggestion_count} suggestions generated, {pending_suggestions} still pending review." if suggestion_count else ("Video must be processed first." if processing is None else "Automatic event suggestions have not been generated yet."),
            count=suggestion_count,
        )
    )
    stages.append(
        PipelineStageRead(
            key="timeline",
            label="Review timeline",
            status="done" if event_count else ("pending" if suggestion_count else "blocked"),
            progress_percent=100 if event_count else 0,
            detail=f"{event_count} coded timeline events are saved." if event_count else ("Accept suggestions or manually code events to build the timeline." if suggestion_count else "Generate suggestions or code manually first."),
            count=event_count,
        )
    )
    stages.append(
        PipelineStageRead(
            key="evidence",
            label="Evidence library",
            status="done" if evidence_count else "pending",
            progress_percent=100 if evidence_count else 0,
            detail=f"{evidence_count} evidence records are linked to this video." if evidence_count else "Evidence will build from uploads and coded events.",
            count=evidence_count,
        )
    )
    stages.append(
        PipelineStageRead(
            key="report",
            label="Report readiness",
            status="done" if event_count else "blocked",
            progress_percent=100 if event_count else 0,
            detail="Report can be generated from reviewed coded events." if event_count else "A useful report needs reviewed timeline events.",
        )
    )

    done_count = sum(1 for stage in stages if stage.status == "done")
    failed_stage = next((stage for stage in stages if stage.status == "failed"), None)
    status_value: StageStatus = "failed" if failed_stage else ("running" if active else ("done" if done_count == len(stages) else "pending"))
    message = active.message if active else ("Pipeline complete." if status_value == "done" else "Pipeline has remaining stages to run or review.")
    return PipelineStatusRead(
        match_id=match_id,
        video_asset_id=video.id,
        status=status_value,
        progress_percent=round((done_count / len(stages)) * 100),
        message=message or "Pipeline status ready.",
        active_job_id=active.id if active else None,
        stages=stages,
    )


def _run_pipeline_job(job_id: int, payload: dict[str, object]) -> None:
    with SessionLocal() as db:
        job = db.get(AnalysisJob, job_id)
        if job is None:
            return
        try:
            video = db.get(VideoAsset, job.video_asset_id)
            if video is None:
                raise RuntimeError("Pipeline video could not be found.")

            logger.info("pipeline_start job_id=%s video_id=%s diagnostics=%s", job.id, video.id, runtime_diagnostics())
            processing = db.scalar(select(VideoProcessingResult).where(VideoProcessingResult.video_asset_id == video.id))
            if processing is None:
                job.message = "Pipeline: processing uploaded video."
                job.progress_percent = 10
                db.commit()
                process_job(db, job)
                job = db.get(AnalysisJob, job_id)
                if job is None:
                    return
                job.status = AnalysisStatus.processing
                job.message = "Pipeline: video processing complete."
                job.progress_percent = 35
                db.commit()

            vision_count = _count(db, select(VisionFrameObservation.id).where(VisionFrameObservation.video_asset_id == video.id))
            if payload.get("run_vision", True) and vision_count == 0:
                job.message = "Pipeline: sampling vision frames."
                job.progress_percent = 50
                db.commit()
                run_vision(VisionRunRequest(video_asset_id=video.id, interval_seconds=30, max_frames=12, replace_existing=False), db)

            suggestion_count = _count(db, select(AutomaticEventSuggestion.id).where(AutomaticEventSuggestion.video_asset_id == video.id))
            if payload.get("run_suggestions", True) and suggestion_count == 0:
                job.message = "Pipeline: generating automatic event suggestions."
                job.progress_percent = 75
                db.commit()
                _create_suggestions(DetectionRequest(video_asset_id=video.id, replace_pending=False), db, job)

            job.status = AnalysisStatus.completed
            job.progress_percent = 100
            job.message = "Pipeline complete. Review suggestions, confirm timeline events, then generate the report."
            db.commit()
            logger.info("pipeline_end job_id=%s video_id=%s diagnostics=%s", job.id, video.id, runtime_diagnostics())
        except Exception as exc:  # pragma: no cover - provider/runtime dependent
            logger.exception("Pipeline job %s failed", job_id)
            db.rollback()
            failed = db.get(AnalysisJob, job_id)
            if failed is not None:
                failed.status = AnalysisStatus.failed
                failed.progress_percent = 100
                failed.message = str(exc)[:1000]
                db.commit()


@router.get("/{match_id}/pipeline", response_model=PipelineStatusRead)
def get_pipeline_status(match_id: int, video_asset_id: int | None = None, db: Session = Depends(get_db)) -> PipelineStatusRead:
    return _pipeline_status(match_id, db, video_asset_id)


@router.post("/{match_id}/pipeline/run", response_model=PipelineStatusRead, status_code=status.HTTP_202_ACCEPTED)
def run_pipeline(
    match_id: int,
    payload: PipelineRunRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> PipelineStatusRead:
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    video = db.get(VideoAsset, payload.video_asset_id) if payload.video_asset_id is not None else _latest_video(match_id, db)
    if video is None:
        raise HTTPException(status_code=409, detail="Upload match footage before running the analysis pipeline.")
    if video.match_id != match_id:
        raise HTTPException(status_code=422, detail="Video does not belong to this match.")
    active = _active_job(match_id, video.id, db)
    if active is not None:
        return _pipeline_status(match_id, db, video.id)

    job = AnalysisJob(
        match_id=match_id,
        video_asset_id=video.id,
        status=AnalysisStatus.processing,
        progress_percent=5,
        message="Pipeline queued: preparing video, vision and suggestions.",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    background_tasks.add_task(_run_pipeline_job, job.id, payload.model_dump())
    return _pipeline_status(match_id, db, video.id)
