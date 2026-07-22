import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from app.clips import generate_event_clip
from app.database import get_db
from app.event_schemas import EventClipRead, TimelineEventCreate, TimelineEventRead, TimelineEventUpdate
from app.models import AutomaticEventSuggestion, EventClip, EvidenceItem, Match, SportType, TimelineEvent, VideoAsset, VideoProcessingResult
from app.object_storage import delete_object, is_object_uri
from app.rugby_analysis import (
    EVENT_SOURCE_LINKED,
    EVIDENCE_SOURCE_INFERRED,
    EVIDENCE_SOURCE_MANUAL,
    TRUST_CONFIRMED,
    TRUST_INFERRED_UNCONFIRMED,
    TRUST_LINKED_UNCONFIRMED,
    evidence_for_event,
)
from app.rugby_inference import EVENT_SOURCE_INFERRED, TRUST_STALE, immediate_inference_candidates, infer_events
from app.sports import sport_rule_pack
from app.storage import delete_stored_file

router = APIRouter(prefix="/api", tags=["timeline"])
logger = logging.getLogger(__name__)


class InferenceRunRequest(BaseModel):
    match_id: int
    video_asset_id: int | None = None
    replace_unconfirmed: bool = True


class InferenceRunRead(BaseModel):
    match_id: int
    video_asset_id: int | None = None
    sport_type: str
    inference_rule_set_id: str
    source_event_count: int
    created_count: int
    stale_count: int
    skipped_count: int
    inferred_event_count: int


def get_event_or_404(event_id: int, db: Session) -> TimelineEvent:
    event = db.scalar(
        select(TimelineEvent)
        .where(TimelineEvent.id == event_id)
        .options(selectinload(TimelineEvent.clip))
    )
    if event is None:
        raise HTTPException(status_code=404, detail="Timeline event not found.")
    return event


def delete_media_reference(storage_path: str) -> None:
    try:
        if is_object_uri(storage_path):
            delete_object(storage_path)
        else:
            delete_stored_file(storage_path)
    except Exception as exc:  # pragma: no cover - filesystem/provider dependent
        logger.warning("Could not delete stored event media %s: %s", storage_path, exc)


def create_clip_for_event(event: TimelineEvent, video: VideoAsset, db: Session) -> None:
    if not event.clip_requested:
        return
    try:
        clip_path, duration = generate_event_clip(video.storage_path, event.id, event.start_seconds, event.end_seconds)
        event.clip = EventClip(file_path=clip_path, duration_seconds=duration)
    except (FileNotFoundError, RuntimeError, ValueError) as exc:
        event.notes = f"{event.notes or ''}\nClip generation failed: {exc}".strip()


def add_event_evidence(event: TimelineEvent, db: Session, *, status: str | None = None, source: str | None = None) -> None:
    match = db.get(Match, event.match_id)
    db.add(evidence_for_event(event, status=status, source=source, sport_type=(match.sport_type.value if match else "rugby_union")))


def _candidate_exists(candidate, events: list[TimelineEvent]) -> bool:
    return any(
        event.team == candidate.team
        and event.event_type == candidate.event_type
        and (event.outcome or "").strip().lower() == candidate.outcome.strip().lower()
        and event.inference_rule == candidate.rule
        and event.created_from_event_ids == candidate.source_json
        and event.trust_status not in {"rejected", TRUST_STALE}
        for event in events
    )


def _create_inferred_event(candidate, parent: TimelineEvent, db: Session) -> TimelineEvent:
    inferred = TimelineEvent(
        match_id=parent.match_id,
        video_asset_id=parent.video_asset_id,
        event_type=candidate.event_type,
        team=candidate.team,
        start_seconds=candidate.start_seconds,
        end_seconds=candidate.end_seconds,
        outcome=candidate.outcome,
        notes=f"Inferred rugby logic: {candidate.reason}",
        field_zone=candidate.field_zone,
        clip_requested=False,
        event_source=EVENT_SOURCE_INFERRED,
        trust_status=TRUST_INFERRED_UNCONFIRMED,
        linked_event_id=candidate.linked_event_id,
        linked_reason=candidate.reason,
        confidence=candidate.confidence,
        inference_rule=candidate.rule,
        created_from_event_ids=candidate.source_json,
    )
    db.add(inferred)
    db.flush()
    add_event_evidence(inferred, db, status=TRUST_INFERRED_UNCONFIRMED, source=EVIDENCE_SOURCE_INFERRED)
    return inferred


def add_linked_events(parent: TimelineEvent, db: Session) -> None:
    if parent.event_source in {EVENT_SOURCE_LINKED, EVENT_SOURCE_INFERRED}:
        return
    existing = list(
        db.scalars(
            select(TimelineEvent).where(
                TimelineEvent.match_id == parent.match_id,
                TimelineEvent.video_asset_id == parent.video_asset_id,
            )
        )
    )
    for candidate in immediate_inference_candidates(parent, existing):
        if not _candidate_exists(candidate, existing):
            _create_inferred_event(candidate, parent, db)


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
    db.flush()

    create_clip_for_event(event, video, db)
    evidence_source = EVIDENCE_SOURCE_MANUAL if event.event_source == "manual" else event.event_source
    add_event_evidence(event, db, status=event.trust_status or TRUST_CONFIRMED, source=evidence_source or EVIDENCE_SOURCE_MANUAL)
    add_linked_events(event, db)
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


@router.post("/timeline-events/infer", response_model=InferenceRunRead)
def run_timeline_inference(payload: InferenceRunRequest, db: Session = Depends(get_db)) -> InferenceRunRead:
    match = db.get(Match, payload.match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    rule_pack = sport_rule_pack(match.sport_type)
    statement = select(TimelineEvent).where(TimelineEvent.match_id == payload.match_id).order_by(
        TimelineEvent.start_seconds,
        TimelineEvent.id,
    )
    if payload.video_asset_id is not None:
        if db.get(VideoAsset, payload.video_asset_id) is None:
            raise HTTPException(status_code=404, detail="Video not found.")
        statement = statement.where(TimelineEvent.video_asset_id == payload.video_asset_id)
    events = list(db.scalars(statement))
    if match.sport_type != SportType.rugby_union:
        return InferenceRunRead(
            match_id=payload.match_id,
            video_asset_id=payload.video_asset_id,
            sport_type=match.sport_type.value,
            inference_rule_set_id=rule_pack.inference_rule_set_id,
            source_event_count=sum(event.event_source not in {EVENT_SOURCE_INFERRED, EVENT_SOURCE_LINKED} for event in events),
            created_count=0,
            stale_count=0,
            skipped_count=0,
            inferred_event_count=sum(event.event_source in {EVENT_SOURCE_INFERRED, EVENT_SOURCE_LINKED} and event.trust_status != TRUST_STALE for event in events),
        )

    stale_count = 0
    if payload.replace_unconfirmed:
        for event in events:
            if (
                event.event_source in {EVENT_SOURCE_INFERRED, EVENT_SOURCE_LINKED}
                and event.trust_status in {TRUST_INFERRED_UNCONFIRMED, TRUST_LINKED_UNCONFIRMED, TRUST_STALE}
            ):
                event.trust_status = TRUST_STALE
                event.linked_reason = f"{event.linked_reason or 'Inferred event'} Marked stale before inference re-run."
                stale_count += 1

    db.flush()
    events = list(db.scalars(statement))
    candidates = infer_events(events)
    created_count = 0
    skipped_count = 0
    for candidate in candidates:
        if _candidate_exists(candidate, events):
            skipped_count += 1
            continue
        parent_id = candidate.linked_event_id or candidate.source_event_ids[0]
        parent = next((event for event in events if event.id == parent_id), None)
        if parent is None:
            skipped_count += 1
            continue
        created = _create_inferred_event(candidate, parent, db)
        events.append(created)
        created_count += 1

    db.commit()
    inferred_event_count = db.scalar(
        select(func.count(TimelineEvent.id))
        .where(TimelineEvent.match_id == payload.match_id)
        .where(TimelineEvent.event_source.in_([EVENT_SOURCE_INFERRED, EVENT_SOURCE_LINKED]))
        .where(TimelineEvent.trust_status != TRUST_STALE)
    )
    return InferenceRunRead(
        match_id=payload.match_id,
        video_asset_id=payload.video_asset_id,
        sport_type=match.sport_type.value,
        inference_rule_set_id=rule_pack.inference_rule_set_id,
        source_event_count=sum(event.event_source not in {EVENT_SOURCE_INFERRED, EVENT_SOURCE_LINKED} for event in events),
        created_count=created_count,
        stale_count=stale_count,
        skipped_count=skipped_count,
        inferred_event_count=int(inferred_event_count or 0),
    )


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


@router.delete("/timeline-events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_timeline_event(event_id: int, db: Session = Depends(get_db)) -> None:
    event = get_event_or_404(event_id, db)
    clip_path = event.clip.file_path if event.clip is not None else None
    db.execute(
        update(TimelineEvent)
        .where(TimelineEvent.linked_event_id == event.id)
        .where(TimelineEvent.event_source.in_([EVENT_SOURCE_INFERRED, EVENT_SOURCE_LINKED]))
        .where(TimelineEvent.trust_status != TRUST_CONFIRMED)
        .values(
            trust_status=TRUST_STALE,
            linked_reason="Source event was deleted; inferred event marked stale.",
        )
    )
    db.execute(
        update(AutomaticEventSuggestion)
        .where(AutomaticEventSuggestion.timeline_event_id == event.id)
        .values(timeline_event_id=None)
    )
    db.execute(
        update(EvidenceItem)
        .where(EvidenceItem.timeline_event_id == event.id)
        .values(timeline_event_id=None, trust_notes="Timeline event was deleted; evidence retained for audit.")
    )
    db.delete(event)
    db.commit()
    if clip_path:
        delete_media_reference(clip_path)


@router.post("/timeline-events/{event_id}/clip", response_model=EventClipRead)
def regenerate_event_clip(event_id: int, db: Session = Depends(get_db)) -> EventClip:
    event = get_event_or_404(event_id, db)
    video = db.get(VideoAsset, event.video_asset_id)
    if video is None:
        raise HTTPException(status_code=404, detail="Source video file is unavailable.")
    try:
        clip_path, duration = generate_event_clip(video.storage_path, event.id, event.start_seconds, event.end_seconds)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Source video file is unavailable.") from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if event.clip is None:
        event.clip = EventClip(file_path=clip_path, duration_seconds=duration)
    else:
        previous_clip_path = event.clip.file_path
        event.clip.file_path = clip_path
        event.clip.duration_seconds = duration
        if previous_clip_path != clip_path:
            delete_media_reference(previous_clip_path)
    db.flush()
    db.execute(
        update(EvidenceItem)
        .where(EvidenceItem.timeline_event_id == event.id)
        .values(
            source_uri=clip_path,
            timestamp_seconds=event.start_seconds,
            trust_notes="Evidence clip regenerated from linked timeline timing.",
        )
    )
    db.commit()
    db.refresh(event.clip)
    return event.clip
