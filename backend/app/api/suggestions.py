from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auto_detection import build_candidates, detect_scene_changes
from app.clips import generate_event_clip
from app.database import get_db
from app.models import (
    AutomaticEventSuggestion,
    EventClip,
    EventTeam,
    EventType,
    SuggestionStatus,
    TimelineEvent,
    VideoAsset,
    VideoProcessingResult,
)
from app.object_storage import materialize
from app.video_processing import probe_video

router = APIRouter(prefix="/api/automatic-suggestions", tags=["automatic suggestions"])
DETECTION_CACHE_DIR = Path("cache/automatic-detection")


class DetectionRequest(BaseModel):
    video_asset_id: int
    replace_pending: bool = True
    scene_threshold: float = Field(default=0.28, ge=0.1, le=0.8)


class SuggestionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    match_id: int
    video_asset_id: int
    event_type: EventType
    team: EventTeam
    start_seconds: float
    end_seconds: float
    confidence: float
    label: str
    reason: str
    status: SuggestionStatus
    timeline_event_id: int | None


class SuggestionUpdate(BaseModel):
    event_type: EventType | None = None
    team: EventTeam | None = None
    start_seconds: float | None = Field(default=None, ge=0)
    end_seconds: float | None = Field(default=None, gt=0)
    label: str | None = Field(default=None, min_length=1, max_length=200)

    @model_validator(mode="after")
    def validate_times(self):
        if self.start_seconds is not None and self.end_seconds is not None and self.end_seconds <= self.start_seconds:
            raise ValueError("End time must be later than start time.")
        return self


def _suggestion_or_404(suggestion_id: int, db: Session) -> AutomaticEventSuggestion:
    suggestion = db.get(AutomaticEventSuggestion, suggestion_id)
    if suggestion is None:
        raise HTTPException(status_code=404, detail="Automatic suggestion not found.")
    return suggestion


def _materialized_video_path(video: VideoAsset) -> Path:
    try:
        return materialize(video.storage_path, DETECTION_CACHE_DIR)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail="The source video is no longer available. Re-upload the footage or connect persistent R2 storage.",
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Persistent video storage is unavailable: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to retrieve the source video from storage: {exc}",
        ) from exc


@router.post("/detect", response_model=list[SuggestionRead], status_code=status.HTTP_201_CREATED)
def detect_suggestions(payload: DetectionRequest, db: Session = Depends(get_db)) -> list[AutomaticEventSuggestion]:
    video = db.get(VideoAsset, payload.video_asset_id)
    if video is None:
        raise HTTPException(status_code=404, detail="Video not found.")

    source_path = _materialized_video_path(video)
    processing = db.scalar(
        select(VideoProcessingResult).where(VideoProcessingResult.video_asset_id == video.id)
    )
    duration = processing.duration_seconds if processing is not None else probe_video(str(source_path)).duration_seconds

    if payload.replace_pending:
        db.execute(
            delete(AutomaticEventSuggestion).where(
                AutomaticEventSuggestion.video_asset_id == video.id,
                AutomaticEventSuggestion.status == SuggestionStatus.pending,
            )
        )
        db.commit()

    try:
        scene_times = detect_scene_changes(str(source_path), threshold=payload.scene_threshold)
    except TimeoutError as exc:
        raise HTTPException(
            status_code=504,
            detail="Automatic detection exceeded the processing time limit. Try a shorter clip or use a higher scene threshold.",
        ) from exc
    except (RuntimeError, FileNotFoundError) as exc:
        raise HTTPException(status_code=500, detail=f"Automatic detection failed: {exc}") from exc

    records = [
        AutomaticEventSuggestion(
            match_id=video.match_id,
            video_asset_id=video.id,
            event_type=candidate.event_type,
            team=EventTeam.neutral,
            start_seconds=candidate.start_seconds,
            end_seconds=candidate.end_seconds,
            confidence=candidate.confidence,
            label=candidate.label,
            reason=candidate.reason,
        )
        for candidate in build_candidates(duration, scene_times)
    ]
    db.add_all(records)
    db.commit()
    for record in records:
        db.refresh(record)
    return records


@router.get("", response_model=list[SuggestionRead])
def list_suggestions(
    match_id: int | None = None,
    video_asset_id: int | None = None,
    suggestion_status: SuggestionStatus | None = None,
    db: Session = Depends(get_db),
) -> list[AutomaticEventSuggestion]:
    statement = select(AutomaticEventSuggestion).order_by(
        AutomaticEventSuggestion.start_seconds,
        AutomaticEventSuggestion.id,
    )
    if match_id is not None:
        statement = statement.where(AutomaticEventSuggestion.match_id == match_id)
    if video_asset_id is not None:
        statement = statement.where(AutomaticEventSuggestion.video_asset_id == video_asset_id)
    if suggestion_status is not None:
        statement = statement.where(AutomaticEventSuggestion.status == suggestion_status)
    return list(db.scalars(statement))


@router.patch("/{suggestion_id}", response_model=SuggestionRead)
def update_suggestion(
    suggestion_id: int,
    payload: SuggestionUpdate,
    db: Session = Depends(get_db),
) -> AutomaticEventSuggestion:
    suggestion = _suggestion_or_404(suggestion_id, db)
    if suggestion.status != SuggestionStatus.pending:
        raise HTTPException(status_code=409, detail="Only pending suggestions can be edited.")
    values = payload.model_dump(exclude_unset=True)
    start = values.get("start_seconds", suggestion.start_seconds)
    end = values.get("end_seconds", suggestion.end_seconds)
    if end <= start:
        raise HTTPException(status_code=422, detail="End time must be later than start time.")
    for field, value in values.items():
        setattr(suggestion, field, value)
    db.commit()
    db.refresh(suggestion)
    return suggestion


@router.post("/{suggestion_id}/accept", response_model=SuggestionRead)
def accept_suggestion(suggestion_id: int, db: Session = Depends(get_db)) -> AutomaticEventSuggestion:
    suggestion = _suggestion_or_404(suggestion_id, db)
    if suggestion.status == SuggestionStatus.accepted:
        return suggestion
    if suggestion.status == SuggestionStatus.rejected:
        raise HTTPException(status_code=409, detail="Rejected suggestions cannot be accepted.")

    event = TimelineEvent(
        match_id=suggestion.match_id,
        video_asset_id=suggestion.video_asset_id,
        event_type=suggestion.event_type,
        team=suggestion.team,
        start_seconds=suggestion.start_seconds,
        end_seconds=suggestion.end_seconds,
        notes=f"Accepted automatic suggestion ({suggestion.confidence:.0%} confidence): {suggestion.reason}",
        clip_requested=True,
    )
    db.add(event)
    db.flush()

    video = db.get(VideoAsset, suggestion.video_asset_id)
    if video is not None:
        try:
            source_path = _materialized_video_path(video)
            clip_path, duration = generate_event_clip(
                str(source_path),
                event.id,
                event.start_seconds,
                event.end_seconds,
            )
            event.clip = EventClip(file_path=clip_path, duration_seconds=duration)
        except (HTTPException, RuntimeError, ValueError) as exc:
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            event.notes = f"{event.notes}\nClip generation failed: {detail}"

    suggestion.status = SuggestionStatus.accepted
    suggestion.timeline_event_id = event.id
    db.commit()
    db.refresh(suggestion)
    return suggestion


@router.post("/{suggestion_id}/reject", response_model=SuggestionRead)
def reject_suggestion(suggestion_id: int, db: Session = Depends(get_db)) -> AutomaticEventSuggestion:
    suggestion = _suggestion_or_404(suggestion_id, db)
    if suggestion.status == SuggestionStatus.accepted:
        raise HTTPException(status_code=409, detail="Accepted suggestions cannot be rejected.")
    suggestion.status = SuggestionStatus.rejected
    db.commit()
    db.refresh(suggestion)
    return suggestion
