import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import delete, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    AnalysisJob,
    AutomaticEventSuggestion,
    Competition,
    EvidenceItem,
    EventClip,
    Match,
    MatchContext,
    MultipartUploadSession,
    Organisation,
    Player,
    RugbyUnderstandingObservation,
    Season,
    Team,
    TimelineEvent,
    VideoAsset,
    VideoProcessingResult,
    VisionFrameObservation,
)
from app.object_storage import abort_multipart_upload, delete_object, is_object_uri
from app.schemas import (
    AnalysisJobCreate,
    AnalysisJobRead,
    AnalysisJobUpdate,
    EvidenceItemCreate,
    EvidenceItemRead,
    EvidenceItemUpdate,
    MatchCreate,
    MatchRead,
    OrganisationCreate,
    OrganisationRead,
    TeamCreate,
    TeamRead,
    VideoAssetRead,
    VideoProcessingResultRead,
)
from app.storage import delete_stored_file, save_video_upload

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)


def _delete_media_reference(storage_path: str) -> None:
    try:
        if is_object_uri(storage_path):
            delete_object(storage_path)
        else:
            delete_stored_file(storage_path)
    except Exception as exc:  # pragma: no cover - filesystem/provider dependent
        logger.warning("Could not delete stored media %s: %s", storage_path, exc)


def _delete_match_tree(match: Match, db: Session) -> None:
    videos = list(db.scalars(select(VideoAsset).where(VideoAsset.match_id == match.id)))
    video_ids = [video.id for video in videos]
    event_ids = list(db.scalars(select(TimelineEvent.id).where(TimelineEvent.match_id == match.id)))
    clip_paths = (
        list(db.scalars(select(EventClip.file_path).where(EventClip.event_id.in_(event_ids)))) if event_ids else []
    )
    processing_results = (
        list(db.scalars(select(VideoProcessingResult).where(VideoProcessingResult.video_asset_id.in_(video_ids))))
        if video_ids
        else []
    )
    vision_frame_paths = list(
        db.scalars(select(VisionFrameObservation.frame_path).where(VisionFrameObservation.match_id == match.id))
    )
    understanding_frame_paths = list(
        db.scalars(
            select(RugbyUnderstandingObservation.source_frame_path).where(
                RugbyUnderstandingObservation.match_id == match.id
            )
        )
    )
    upload_sessions = list(
        db.scalars(select(MultipartUploadSession).where(MultipartUploadSession.match_id == match.id))
    )

    for session in upload_sessions:
        if session.status == "uploading":
            try:
                abort_multipart_upload(session.object_key, session.upload_id)
            except Exception as exc:  # pragma: no cover - provider dependent
                logger.warning("Could not abort multipart upload %s: %s", session.upload_id, exc)

    for video in videos:
        _delete_media_reference(video.storage_path)
    for media_path in [
        *clip_paths,
        *[result.thumbnail_path for result in processing_results],
        *vision_frame_paths,
        *understanding_frame_paths,
    ]:
        _delete_media_reference(media_path)

    if event_ids:
        db.execute(delete(EventClip).where(EventClip.event_id.in_(event_ids)))
    db.execute(delete(EvidenceItem).where(EvidenceItem.match_id == match.id))
    db.execute(delete(TimelineEvent).where(TimelineEvent.match_id == match.id))
    db.execute(delete(MatchContext).where(MatchContext.match_id == match.id))
    db.execute(delete(AutomaticEventSuggestion).where(AutomaticEventSuggestion.match_id == match.id))
    db.execute(delete(VisionFrameObservation).where(VisionFrameObservation.match_id == match.id))
    db.execute(delete(RugbyUnderstandingObservation).where(RugbyUnderstandingObservation.match_id == match.id))
    db.execute(delete(MultipartUploadSession).where(MultipartUploadSession.match_id == match.id))
    if video_ids:
        db.execute(delete(VideoProcessingResult).where(VideoProcessingResult.video_asset_id.in_(video_ids)))
    db.execute(delete(AnalysisJob).where(AnalysisJob.match_id == match.id))
    db.execute(delete(VideoAsset).where(VideoAsset.match_id == match.id))
    db.delete(match)


@router.post("/organisations", response_model=OrganisationRead, status_code=status.HTTP_201_CREATED)
def create_organisation(payload: OrganisationCreate, db: Session = Depends(get_db)) -> Organisation:
    organisation = Organisation(name=payload.name.strip())
    db.add(organisation)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Organisation name already exists.") from exc
    db.refresh(organisation)
    return organisation


@router.get("/organisations", response_model=list[OrganisationRead])
def list_organisations(db: Session = Depends(get_db)) -> list[Organisation]:
    return list(db.scalars(select(Organisation).order_by(Organisation.name)))


@router.delete("/organisations/{organisation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_organisation(organisation_id: int, db: Session = Depends(get_db)) -> None:
    organisation = db.get(Organisation, organisation_id)
    if organisation is None:
        raise HTTPException(status_code=404, detail="Organisation not found.")

    matches = list(db.scalars(select(Match).where(Match.organisation_id == organisation_id)))
    for match in matches:
        _delete_match_tree(match, db)

    db.execute(delete(Player).where(Player.organisation_id == organisation_id))
    db.execute(delete(Competition).where(Competition.organisation_id == organisation_id))
    db.execute(delete(Season).where(Season.organisation_id == organisation_id))
    db.execute(delete(Team).where(Team.organisation_id == organisation_id))
    db.delete(organisation)
    db.commit()


@router.post("/teams", response_model=TeamRead, status_code=status.HTTP_201_CREATED)
def create_team(payload: TeamCreate, db: Session = Depends(get_db)) -> Team:
    if db.get(Organisation, payload.organisation_id) is None:
        raise HTTPException(status_code=404, detail="Organisation not found.")
    team = Team(**payload.model_dump())
    db.add(team)
    db.commit()
    db.refresh(team)
    return team


@router.get("/teams", response_model=list[TeamRead])
def list_teams(organisation_id: int | None = None, db: Session = Depends(get_db)) -> list[Team]:
    statement = select(Team).order_by(Team.name)
    if organisation_id is not None:
        statement = statement.where(Team.organisation_id == organisation_id)
    return list(db.scalars(statement))


@router.delete("/teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(team_id: int, db: Session = Depends(get_db)) -> None:
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found.")
    match_exists = db.scalar(
        select(Match.id).where(or_(Match.home_team_id == team_id, Match.away_team_id == team_id)).limit(1)
    )
    if match_exists is not None:
        raise HTTPException(status_code=409, detail="Delete matches using this team before deleting the team.")

    db.execute(update(Player).where(Player.team_id == team_id).values(team_id=None))
    db.delete(team)
    db.commit()


@router.post("/matches", response_model=MatchRead, status_code=status.HTTP_201_CREATED)
def create_match(payload: MatchCreate, db: Session = Depends(get_db)) -> Match:
    if payload.home_team_id == payload.away_team_id:
        raise HTTPException(status_code=422, detail="Home and away teams must be different.")
    organisation = db.get(Organisation, payload.organisation_id)
    home_team = db.get(Team, payload.home_team_id)
    away_team = db.get(Team, payload.away_team_id)
    if organisation is None or home_team is None or away_team is None:
        raise HTTPException(status_code=404, detail="Organisation or team not found.")
    if home_team.organisation_id != payload.organisation_id or away_team.organisation_id != payload.organisation_id:
        raise HTTPException(status_code=422, detail="Both teams must belong to the selected organisation.")
    match = Match(**payload.model_dump())
    db.add(match)
    db.commit()
    db.refresh(match)
    return match


@router.get("/matches", response_model=list[MatchRead])
def list_matches(organisation_id: int | None = None, db: Session = Depends(get_db)) -> list[Match]:
    statement = select(Match).order_by(Match.match_date.desc(), Match.id.desc())
    if organisation_id is not None:
        statement = statement.where(Match.organisation_id == organisation_id)
    return list(db.scalars(statement))


@router.get("/matches/{match_id}", response_model=MatchRead)
def get_match(match_id: int, db: Session = Depends(get_db)) -> Match:
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    return match


@router.delete("/matches/{match_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_match(match_id: int, db: Session = Depends(get_db)) -> None:
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    _delete_match_tree(match, db)
    db.commit()


@router.post("/matches/{match_id}/videos", response_model=VideoAssetRead, status_code=status.HTTP_201_CREATED)
def upload_match_video(
    match_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> VideoAsset:
    if db.get(Match, match_id) is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    try:
        stored_filename, storage_path, size_bytes = save_video_upload(file)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    video = VideoAsset(
        match_id=match_id,
        original_filename=file.filename or "match-video",
        stored_filename=stored_filename,
        content_type=file.content_type,
        size_bytes=size_bytes,
        storage_path=storage_path,
    )
    db.add(video)
    try:
        db.commit()
    except Exception:
        db.rollback()
        delete_stored_file(storage_path)
        raise
    db.refresh(video)
    return video


@router.get("/matches/{match_id}/videos", response_model=list[VideoAssetRead])
def list_match_videos(match_id: int, db: Session = Depends(get_db)) -> list[VideoAsset]:
    if db.get(Match, match_id) is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    statement = select(VideoAsset).where(VideoAsset.match_id == match_id).order_by(VideoAsset.created_at.desc())
    return list(db.scalars(statement))


@router.get("/videos/{video_asset_id}/processing-result", response_model=VideoProcessingResultRead)
def get_video_processing_result(
    video_asset_id: int,
    db: Session = Depends(get_db),
) -> VideoProcessingResult:
    result = db.scalar(
        select(VideoProcessingResult).where(VideoProcessingResult.video_asset_id == video_asset_id)
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Video processing result not found.")
    return result


def _validate_evidence_references(
    match_id: int,
    db: Session,
    video_asset_id: int | None = None,
    timeline_event_id: int | None = None,
) -> None:
    if db.get(Match, match_id) is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    if video_asset_id is not None:
        video = db.get(VideoAsset, video_asset_id)
        if video is None or video.match_id != match_id:
            raise HTTPException(status_code=422, detail="Video does not belong to this match.")
    if timeline_event_id is not None:
        event = db.get(TimelineEvent, timeline_event_id)
        if event is None or event.match_id != match_id:
            raise HTTPException(status_code=422, detail="Timeline event does not belong to this match.")


@router.post("/evidence-items", response_model=EvidenceItemRead, status_code=status.HTTP_201_CREATED)
def create_evidence_item(payload: EvidenceItemCreate, db: Session = Depends(get_db)) -> EvidenceItem:
    _validate_evidence_references(payload.match_id, db, payload.video_asset_id, payload.timeline_event_id)
    item = EvidenceItem(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/evidence-items", response_model=list[EvidenceItemRead])
def list_evidence_items(
    match_id: int | None = None,
    video_asset_id: int | None = None,
    approved_for_training: bool | None = None,
    db: Session = Depends(get_db),
) -> list[EvidenceItem]:
    statement = select(EvidenceItem).order_by(EvidenceItem.created_at.desc(), EvidenceItem.id.desc())
    if match_id is not None:
        statement = statement.where(EvidenceItem.match_id == match_id)
    if video_asset_id is not None:
        statement = statement.where(EvidenceItem.video_asset_id == video_asset_id)
    if approved_for_training is not None:
        statement = statement.where(EvidenceItem.approved_for_training == approved_for_training)
    return list(db.scalars(statement))


@router.patch("/evidence-items/{item_id}", response_model=EvidenceItemRead)
def update_evidence_item(
    item_id: int,
    payload: EvidenceItemUpdate,
    db: Session = Depends(get_db),
) -> EvidenceItem:
    item = db.get(EvidenceItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Evidence item not found.")
    updates = payload.model_dump(exclude_unset=True)
    next_video_id = updates.get("video_asset_id", item.video_asset_id)
    next_event_id = updates.get("timeline_event_id", item.timeline_event_id)
    _validate_evidence_references(item.match_id, db, next_video_id, next_event_id)
    for field, value in updates.items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/evidence-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_evidence_item(item_id: int, db: Session = Depends(get_db)) -> None:
    item = db.get(EvidenceItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Evidence item not found.")
    db.delete(item)
    db.commit()


@router.post("/analysis-jobs", response_model=AnalysisJobRead, status_code=status.HTTP_201_CREATED)
def create_analysis_job(payload: AnalysisJobCreate, db: Session = Depends(get_db)) -> AnalysisJob:
    if db.get(Match, payload.match_id) is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    if payload.video_asset_id is not None:
        video = db.get(VideoAsset, payload.video_asset_id)
        if video is None or video.match_id != payload.match_id:
            raise HTTPException(status_code=422, detail="Video does not belong to this match.")
    job = AnalysisJob(**payload.model_dump())
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@router.get("/analysis-jobs", response_model=list[AnalysisJobRead])
def list_analysis_jobs(match_id: int | None = None, db: Session = Depends(get_db)) -> list[AnalysisJob]:
    statement = select(AnalysisJob).order_by(AnalysisJob.created_at.desc())
    if match_id is not None:
        statement = statement.where(AnalysisJob.match_id == match_id)
    return list(db.scalars(statement))


@router.get("/analysis-jobs/{job_id}", response_model=AnalysisJobRead)
def get_analysis_job(job_id: int, db: Session = Depends(get_db)) -> AnalysisJob:
    job = db.get(AnalysisJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Analysis job not found.")
    return job


@router.patch("/analysis-jobs/{job_id}", response_model=AnalysisJobRead)
def update_analysis_job(job_id: int, payload: AnalysisJobUpdate, db: Session = Depends(get_db)) -> AnalysisJob:
    job = db.get(AnalysisJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Analysis job not found.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(job, field, value)
    db.commit()
    db.refresh(job)
    return job
