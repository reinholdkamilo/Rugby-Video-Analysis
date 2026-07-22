from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    EventClip,
    EventTeam,
    EvidenceItem,
    LibraryAnnotation,
    LibraryCollection,
    LibraryComment,
    Match,
    SportType,
    Team,
    TimelineEvent,
    VideoAsset,
    VideoProcessingResult,
)
from app.rugby_taxonomy import taxonomy_category, taxonomy_event_id
from app.sports import sport_rule_pack

router = APIRouter(prefix="/api/library", tags=["library"])


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LibraryItemRead(BaseModel):
    id: str
    item_type: Literal["game", "clip", "playlist", "report", "evidence", "coach_review"]
    title: str
    sport_type: str | None = None
    sport_display_name: str | None = None
    match_id: int | None = None
    video_asset_id: int | None = None
    timeline_event_id: int | None = None
    collection_id: int | None = None
    evidence_item_id: int | None = None
    home_team: str | None = None
    away_team: str | None = None
    match_date: str | None = None
    competition: str | None = None
    venue: str | None = None
    duration_seconds: float | None = None
    clip_count: int = 0
    event_count: int = 0
    status: str = "active"
    labels: list[str] = []
    thumbnail_path: str | None = None
    created_at: datetime | None = None


class LibraryCollectionRef(BaseModel):
    ref_type: Literal["timeline_event", "clip", "evidence", "video"]
    ref_id: int
    label: str | None = Field(default=None, max_length=200)


class LibraryCollectionCreate(BaseModel):
    collection_type: Literal["playlist", "coach_review"] = "playlist"
    title: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    sport_type: SportType = SportType.rugby_union
    match_id: int | None = None
    video_asset_id: int | None = None
    labels: list[str] = []
    items: list[LibraryCollectionRef] = []


class LibraryCollectionRead(ORMModel):
    id: int
    collection_type: str
    title: str
    description: str | None
    sport_type: SportType
    match_id: int | None
    video_asset_id: int | None
    labels: list[str]
    item_refs: list[dict[str, object]]
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


class LibraryCommentCreate(BaseModel):
    collection_id: int | None = None
    match_id: int | None = None
    video_asset_id: int | None = None
    timeline_event_id: int | None = None
    timestamp_seconds: float | None = Field(default=None, ge=0)
    body: str = Field(min_length=1, max_length=4000)
    tags: list[str] = []


class LibraryCommentRead(ORMModel):
    id: int
    collection_id: int | None
    match_id: int | None
    video_asset_id: int | None
    timeline_event_id: int | None
    timestamp_seconds: float | None
    body: str
    tags: list[str]
    created_at: datetime
    updated_at: datetime


class LibraryAnnotationCreate(BaseModel):
    collection_id: int | None = None
    match_id: int | None = None
    video_asset_id: int | None = None
    timeline_event_id: int | None = None
    comment_id: int | None = None
    timestamp_seconds: float | None = Field(default=None, ge=0)
    shape_type: Literal["arrow", "circle", "line", "text"] = "text"
    colour: str = Field(default="#f5b400", max_length=40)
    coordinates: dict[str, object] = {}
    label: str | None = Field(default=None, max_length=200)


class LibraryAnnotationRead(ORMModel):
    id: int
    collection_id: int | None
    match_id: int | None
    video_asset_id: int | None
    timeline_event_id: int | None
    comment_id: int | None
    timestamp_seconds: float | None
    shape_type: str
    colour: str
    coordinates: dict[str, object]
    label: str | None
    created_at: datetime


class TimelineLaneEvent(BaseModel):
    id: int
    lane: str
    label: str
    team: str
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    category: str
    source: str
    trust_status: str
    field_zone: str | None = None


class TimelineLanesRead(BaseModel):
    match_id: int
    sport_type: str
    lanes: list[str]
    events: list[TimelineLaneEvent]


def _team_names(db: Session) -> dict[int, str]:
    return {team.id: team.name for team in db.scalars(select(Team))}


def _match_title(match: Match, teams: dict[int, str]) -> str:
    return f"{teams.get(match.home_team_id, 'Home')} vs {teams.get(match.away_team_id, 'Away')}"


def _sport_name(value: SportType | str | None) -> str | None:
    if value is None:
        return None
    return sport_rule_pack(value).display_name


def _thumbnail_by_video(db: Session, video_ids: list[int]) -> dict[int, str]:
    if not video_ids:
        return {}
    rows = db.scalars(select(VideoProcessingResult).where(VideoProcessingResult.video_asset_id.in_(video_ids)))
    return {row.video_asset_id: row.thumbnail_path for row in rows}


def _duration_by_video(db: Session, video_ids: list[int]) -> dict[int, float]:
    if not video_ids:
        return {}
    rows = db.scalars(select(VideoProcessingResult).where(VideoProcessingResult.video_asset_id.in_(video_ids)))
    return {row.video_asset_id: row.duration_seconds for row in rows}


@router.get("/items", response_model=list[LibraryItemRead])
def list_library_items(
    search: str | None = None,
    item_type: str | None = None,
    sport_type: SportType | None = None,
    match_id: int | None = None,
    limit: int = Query(default=120, ge=1, le=300),
    db: Session = Depends(get_db),
) -> list[LibraryItemRead]:
    teams = _team_names(db)
    items: list[LibraryItemRead] = []

    match_statement = select(Match).order_by(Match.match_date.desc(), Match.id.desc()).limit(limit)
    if sport_type is not None:
        match_statement = match_statement.where(Match.sport_type == sport_type)
    if match_id is not None:
        match_statement = match_statement.where(Match.id == match_id)
    matches = list(db.scalars(match_statement))
    match_ids = [match.id for match in matches]
    videos = list(db.scalars(select(VideoAsset).where(VideoAsset.match_id.in_(match_ids)))) if match_ids else []
    video_ids = [video.id for video in videos]
    thumbnails = _thumbnail_by_video(db, video_ids)
    durations = _duration_by_video(db, video_ids)
    video_by_match: dict[int, list[VideoAsset]] = {}
    for video in videos:
        video_by_match.setdefault(video.match_id, []).append(video)
    event_counts = {
        row.match_id: row.count
        for row in db.execute(
            select(TimelineEvent.match_id, func.count(TimelineEvent.id).label("count")).group_by(TimelineEvent.match_id)
        )
    }
    clip_counts = {
        row.match_id: row.count
        for row in db.execute(
            select(TimelineEvent.match_id, func.count(EventClip.id).label("count"))
            .join(EventClip, EventClip.event_id == TimelineEvent.id)
            .group_by(TimelineEvent.match_id)
        )
    }

    for match in matches:
        match_videos = video_by_match.get(match.id, [])
        first_video = match_videos[0] if match_videos else None
        title = _match_title(match, teams)
        common = {
            "sport_type": match.sport_type.value,
            "sport_display_name": _sport_name(match.sport_type),
            "match_id": match.id,
            "video_asset_id": first_video.id if first_video else None,
            "home_team": teams.get(match.home_team_id),
            "away_team": teams.get(match.away_team_id),
            "match_date": match.match_date.isoformat(),
            "competition": match.competition,
            "venue": match.venue,
            "duration_seconds": durations.get(first_video.id) if first_video else None,
            "clip_count": int(clip_counts.get(match.id, 0)),
            "event_count": int(event_counts.get(match.id, 0)),
            "thumbnail_path": thumbnails.get(first_video.id) if first_video else None,
            "created_at": match.created_at,
        }
        items.append(LibraryItemRead(id=f"match:{match.id}", item_type="game", title=title, labels=["Full match"], **common))
        items.append(LibraryItemRead(id=f"report:{match.id}", item_type="report", title=f"{title} report", labels=["Report"], **common))

    event_rows = list(
        db.scalars(
            select(TimelineEvent)
            .where(TimelineEvent.clip_requested.is_(True))
            .order_by(TimelineEvent.created_at.desc(), TimelineEvent.id.desc())
            .limit(limit)
        )
    )
    matches_by_id = {match.id: match for match in db.scalars(select(Match).where(Match.id.in_({event.match_id for event in event_rows})))}
    for event in event_rows:
        match = matches_by_id.get(event.match_id)
        if match is None:
            continue
        label = (event.outcome or event.event_type.value).replace("_", " ").title()
        items.append(
            LibraryItemRead(
                id=f"clip:{event.id}",
                item_type="clip",
                title=f"{label} at {int(event.start_seconds // 60):02d}:{int(event.start_seconds % 60):02d}",
                sport_type=match.sport_type.value,
                sport_display_name=_sport_name(match.sport_type),
                match_id=event.match_id,
                video_asset_id=event.video_asset_id,
                timeline_event_id=event.id,
                home_team=teams.get(match.home_team_id),
                away_team=teams.get(match.away_team_id),
                match_date=match.match_date.isoformat(),
                competition=match.competition,
                duration_seconds=max(0, event.end_seconds - event.start_seconds),
                clip_count=1,
                event_count=1,
                status=event.trust_status,
                labels=[event.team.value, taxonomy_category(event), event.event_source],
                thumbnail_path=thumbnails.get(event.video_asset_id),
                created_at=event.created_at,
            )
        )

    evidence_rows = list(db.scalars(select(EvidenceItem).order_by(EvidenceItem.created_at.desc()).limit(limit)))
    for evidence in evidence_rows:
        match = matches_by_id.get(evidence.match_id) or db.get(Match, evidence.match_id)
        items.append(
            LibraryItemRead(
                id=f"evidence:{evidence.id}",
                item_type="evidence",
                title=evidence.label,
                sport_type=evidence.sport_type.value,
                sport_display_name=_sport_name(evidence.sport_type),
                match_id=evidence.match_id,
                video_asset_id=evidence.video_asset_id,
                timeline_event_id=evidence.timeline_event_id,
                evidence_item_id=evidence.id,
                home_team=teams.get(match.home_team_id) if match else None,
                away_team=teams.get(match.away_team_id) if match else None,
                match_date=match.match_date.isoformat() if match else None,
                competition=match.competition if match else None,
                status=evidence.status,
                labels=[evidence.evidence_type.value, evidence.source, evidence.rugby_element or ""],
                created_at=evidence.created_at,
            )
        )

    collections = list(
        db.scalars(select(LibraryCollection).where(LibraryCollection.archived_at.is_(None)).order_by(LibraryCollection.updated_at.desc()).limit(limit))
    )
    for collection in collections:
        match = db.get(Match, collection.match_id) if collection.match_id else None
        refs = collection.item_refs
        items.append(
            LibraryItemRead(
                id=f"collection:{collection.id}",
                item_type="coach_review" if collection.collection_type == "coach_review" else "playlist",
                title=collection.title,
                sport_type=collection.sport_type.value,
                sport_display_name=_sport_name(collection.sport_type),
                match_id=collection.match_id,
                video_asset_id=collection.video_asset_id,
                collection_id=collection.id,
                home_team=teams.get(match.home_team_id) if match else None,
                away_team=teams.get(match.away_team_id) if match else None,
                match_date=match.match_date.isoformat() if match else None,
                competition=match.competition if match else None,
                clip_count=len(refs),
                event_count=len(refs),
                labels=collection.labels,
                created_at=collection.created_at,
            )
        )

    if search:
        needle = search.strip().lower()
        items = [
            item for item in items
            if needle in " ".join([item.title, item.sport_display_name or "", item.home_team or "", item.away_team or "", item.competition or "", " ".join(item.labels)]).lower()
        ]
    if item_type:
        items = [item for item in items if item.item_type == item_type]
    if sport_type is not None:
        items = [item for item in items if item.sport_type == sport_type.value]
    if match_id is not None:
        items = [item for item in items if item.match_id == match_id]
    return sorted(items, key=lambda item: item.created_at or datetime.min, reverse=True)[:limit]


@router.post("/collections", response_model=LibraryCollectionRead, status_code=status.HTTP_201_CREATED)
def create_collection(payload: LibraryCollectionCreate, db: Session = Depends(get_db)) -> LibraryCollection:
    if payload.match_id is not None and db.get(Match, payload.match_id) is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    if payload.video_asset_id is not None and db.get(VideoAsset, payload.video_asset_id) is None:
        raise HTTPException(status_code=404, detail="Video not found.")
    collection = LibraryCollection(
        collection_type=payload.collection_type,
        title=payload.title.strip(),
        description=payload.description,
        sport_type=payload.sport_type,
        match_id=payload.match_id,
        video_asset_id=payload.video_asset_id,
    )
    collection.set_labels(payload.labels)
    collection.set_item_refs([ref.model_dump() for ref in payload.items])
    db.add(collection)
    db.commit()
    db.refresh(collection)
    return collection


@router.get("/collections", response_model=list[LibraryCollectionRead])
def list_collections(
    collection_type: str | None = None,
    include_archived: bool = False,
    db: Session = Depends(get_db),
) -> list[LibraryCollection]:
    statement = select(LibraryCollection).order_by(LibraryCollection.updated_at.desc(), LibraryCollection.id.desc())
    if collection_type:
        statement = statement.where(LibraryCollection.collection_type == collection_type)
    if not include_archived:
        statement = statement.where(LibraryCollection.archived_at.is_(None))
    return list(db.scalars(statement))


@router.get("/collections/{collection_id}", response_model=LibraryCollectionRead)
def get_collection(collection_id: int, db: Session = Depends(get_db)) -> LibraryCollection:
    collection = db.get(LibraryCollection, collection_id)
    if collection is None:
        raise HTTPException(status_code=404, detail="Collection not found.")
    return collection


@router.post("/comments", response_model=LibraryCommentRead, status_code=status.HTTP_201_CREATED)
def create_comment(payload: LibraryCommentCreate, db: Session = Depends(get_db)) -> LibraryComment:
    if payload.collection_id is not None and db.get(LibraryCollection, payload.collection_id) is None:
        raise HTTPException(status_code=404, detail="Collection not found.")
    comment = LibraryComment(**payload.model_dump(exclude={"tags"}))
    comment.set_tags(payload.tags)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


@router.get("/comments", response_model=list[LibraryCommentRead])
def list_comments(
    collection_id: int | None = None,
    match_id: int | None = None,
    timeline_event_id: int | None = None,
    db: Session = Depends(get_db),
) -> list[LibraryComment]:
    statement = select(LibraryComment).order_by(LibraryComment.created_at.desc(), LibraryComment.id.desc())
    if collection_id is not None:
        statement = statement.where(LibraryComment.collection_id == collection_id)
    if match_id is not None:
        statement = statement.where(LibraryComment.match_id == match_id)
    if timeline_event_id is not None:
        statement = statement.where(LibraryComment.timeline_event_id == timeline_event_id)
    return list(db.scalars(statement))


@router.post("/annotations", response_model=LibraryAnnotationRead, status_code=status.HTTP_201_CREATED)
def create_annotation(payload: LibraryAnnotationCreate, db: Session = Depends(get_db)) -> LibraryAnnotation:
    annotation = LibraryAnnotation(**payload.model_dump(exclude={"coordinates"}))
    annotation.set_coordinates(payload.coordinates)
    db.add(annotation)
    db.commit()
    db.refresh(annotation)
    return annotation


@router.get("/annotations", response_model=list[LibraryAnnotationRead])
def list_annotations(
    collection_id: int | None = None,
    match_id: int | None = None,
    timeline_event_id: int | None = None,
    db: Session = Depends(get_db),
) -> list[LibraryAnnotation]:
    statement = select(LibraryAnnotation).order_by(LibraryAnnotation.created_at.desc(), LibraryAnnotation.id.desc())
    if collection_id is not None:
        statement = statement.where(LibraryAnnotation.collection_id == collection_id)
    if match_id is not None:
        statement = statement.where(LibraryAnnotation.match_id == match_id)
    if timeline_event_id is not None:
        statement = statement.where(LibraryAnnotation.timeline_event_id == timeline_event_id)
    return list(db.scalars(statement))


def _sport_lanes(sport_type: SportType) -> list[str]:
    if sport_type == SportType.rugby_league:
        return ["Sets", "Tackle Count", "Carries / Hit Ups", "Tackles", "Play The Ball", "Kicks", "Errors", "Penalties / Six Agains", "Tries", "Restarts"]
    if sport_type == SportType.afl:
        return ["Possession Chains", "Disposals", "Marks", "Tackles", "Inside 50s", "Clearances", "Turnovers", "Stoppages", "Scores"]
    return ["Possessions", "Carries", "Tackles", "Rucks", "Lineouts", "Scrums", "Mauls", "Kicks", "Penalties", "Tries", "Turnovers", "Zones"]


def _lane_for_event(event: TimelineEvent, sport_type: SportType) -> str:
    text = " ".join([event.event_type.value, event.outcome or "", event.notes or "", event.field_zone or ""]).lower()
    event_id = taxonomy_event_id(event)
    if "try" in text:
        return "Tries" if sport_type != SportType.afl else "Scores"
    if "tackle" in text:
        return "Tackles"
    if "ruck" in text:
        return "Rucks"
    if "scrum" in text:
        return "Scrums"
    if "lineout" in text:
        return "Lineouts"
    if "maul" in text:
        return "Mauls"
    if "kick" in text or event_id in {"exit", "drop_goal"}:
        return "Kicks"
    if "penalty" in text or "six again" in text:
        return "Penalties / Six Agains" if sport_type == SportType.rugby_league else "Penalties"
    if "turnover" in text:
        return "Turnovers"
    if "carry" in text or "hit up" in text:
        return "Carries / Hit Ups" if sport_type == SportType.rugby_league else "Carries"
    if "zone" in text or event.field_zone:
        return "Zones"
    if sport_type == SportType.afl and ("mark" in text):
        return "Marks"
    if sport_type == SportType.afl and ("inside 50" in text):
        return "Inside 50s"
    return "Possessions" if sport_type == SportType.rugby_union else _sport_lanes(sport_type)[0]


@router.get("/timeline-lanes", response_model=TimelineLanesRead)
def get_timeline_lanes(
    match_id: int,
    video_asset_id: int | None = None,
    db: Session = Depends(get_db),
) -> TimelineLanesRead:
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    statement = select(TimelineEvent).where(TimelineEvent.match_id == match_id).order_by(TimelineEvent.start_seconds, TimelineEvent.id)
    if video_asset_id is not None:
        statement = statement.where(TimelineEvent.video_asset_id == video_asset_id)
    events = [
        event for event in db.scalars(statement)
        if event.trust_status not in {"rejected", "stale"}
    ]
    lanes = _sport_lanes(match.sport_type)
    lane_events = [
        TimelineLaneEvent(
            id=event.id,
            lane=_lane_for_event(event, match.sport_type),
            label=(event.outcome or event.event_type.value).replace("_", " ").title(),
            team=event.team.value if isinstance(event.team, EventTeam) else str(event.team),
            start_seconds=event.start_seconds,
            end_seconds=event.end_seconds,
            duration_seconds=max(0, event.end_seconds - event.start_seconds),
            category=taxonomy_category(event),
            source=event.event_source,
            trust_status=event.trust_status,
            field_zone=event.field_zone,
        )
        for event in events
    ]
    return TimelineLanesRead(match_id=match.id, sport_type=match.sport_type.value, lanes=lanes, events=lane_events)
