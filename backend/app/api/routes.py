from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AnalysisJob, Match, Organisation, Team, VideoAsset
from app.schemas import (
    AnalysisJobCreate,
    AnalysisJobRead,
    AnalysisJobUpdate,
    MatchCreate,
    MatchRead,
    OrganisationCreate,
    OrganisationRead,
    TeamCreate,
    TeamRead,
    VideoAssetRead,
)
from app.storage import delete_stored_file, save_video_upload

router = APIRouter(prefix="/api")


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
