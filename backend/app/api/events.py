from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.clips import generate_event_clip
from app.database import get_db
from app.event_schemas import EventClipRead, TimelineEventCreate, TimelineEventRead, TimelineEventUpdate
from app.models import EventClip, Match, TimelineEvent, VideoAsset, VideoProcessingResult

router = APIRouter(prefix="/api", tags=["timeline"])


def get_event_or_404(event_id: int, db: Session) -> TimelineEvent:
    event = db.scalar(
        select(TimelineEvent)
        .where(TimelineEvent.id == event_id)
        .options(selectinload(TimelineEvent.clip))
    )
    if event is None:
        raise HTTPException(status_code=404, detail="Timeline event not found.")
    return event


@router.post("/timeline-events", response_model=TimelineEventRead, status_code=status.HTTP_201_CREATED)
def create_timeline_event(payload: TimelineEventCreate, db: Session = Depends(get_db)) -> TimelineEvent:
    match = db.get(Match, payload.match_id)
    video = db.get(VideoAsset, payload.video_asset_id)
    if match is None or video is None:
        raise HTTPException(status_code=404, detail="Match or video not found.")
    if video.match_id != match.id:
        raise HTTPException(status_code=422, detail="Video does not belong to the selected match.")

    processing = db.scalar(select(VideoProcessingResult).where(VideoProcessingResult.video_asset_id == video.id))
    if processing is not None and payload.end_seconds > processing.duration_seconds:
        raise HTTPException(status_code=422, detail="Event end time exceeds the video duration.")

    event = TimelineEvent(**payload.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)

    if event.clip_requested:
        try:
            clip_path, duration = generate_event_clip(video.storage_path, event.id, event.start_seconds, event.end_seconds)
            event.clip = EventClip(file_path=clip_path, duration_seconds=duration)
            db.commit()
            db.refresh(event)
        except (RuntimeError, ValueError) as exc:
            event.notes = f"{event.notes or ''}\nClip generation failed: {exc}".strip()
            db.commit()
            db.refresh(event)
    return get_event_or_404(event.id, db)


@router.get("/timeline-events", response_model=list[TimelineEventRead])
def list_timeline_events(
    match_id: int | None = None,
    video_asset_id: int | None = None,
    db: Session = Depends(get_db),
) -> list[TimelineEvent]:
    statement = select(TimelineEvent).options(selectinload(TimelineEvent.clip)).order_by(
        TimelineEvent.start_seconds, TimelineEvent.id
    )
    if match_id is not None:
        statement = statement.where(TimelineEvent.match_id == match_id)
    if video_asset_id is not None:
        statement = statement.where(TimelineEvent.video_asset_id == video_asset_id)
    return list(db.scalars(statement).unique())


@router.get("/timeline-events/{event_id}", response_model=TimelineEventRead)
def get_timeline_event(event_id: int, db: Session = Depends(get_db)) -> TimelineEvent:
    return get_event_or_404(event_id, db)


@router.patch("/timeline-events/{event_id}", response_model=TimelineEventRead)
def update_timeline_event(
    event_id: int,
    payload: TimelineEventUpdate,
    db: Session = Depends(get_db),
) -> TimelineEvent:
    event = get_event_or_404(event_id, db)
    values = payload.model_dump(exclude_unset=True)
    start = values.get("start_seconds", event.start_seconds)
    end = values.get("end_seconds", event.end_seconds)
    if end <= start:
        raise HTTPException(status_code=422, detail="End time must be later than start time.")
    if end - start > 300:
        raise HTTPException(status_code=422, detail="A single event clip cannot exceed five minutes.")
    for field, value in values.items():
        setattr(event, field, value)
    db.commit()
    db.refresh(event)
    return get_event_or_404(event.id, db)


@router.post("/timeline-events/{event_id}/clip", response_model=EventClipRead)
def regenerate_event_clip(event_id: int, db: Session = Depends(get_db)) -> EventClip:
    event = get_event_or_404(event_id, db)
    video = db.get(VideoAsset, event.video_asset_id)
    if video is None or not Path(video.storage_path).exists():
        raise HTTPException(status_code=404, detail="Source video file is unavailable.")
    try:
        clip_path, duration = generate_event_clip(video.storage_path, event.id, event.start_seconds, event.end_seconds)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if event.clip is None:
        event.clip = EventClip(file_path=clip_path, duration_seconds=duration)
    else:
        event.clip.file_path = clip_path
        event.clip.duration_seconds = duration
    db.commit()
    db.refresh(event.clip)
    return event.clip
