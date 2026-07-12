from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import AnalysisStatus


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class OrganisationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)


class OrganisationRead(ORMModel):
    id: int
    name: str
    created_at: datetime


class TeamCreate(BaseModel):
    organisation_id: int
    name: str = Field(min_length=2, max_length=150)
    age_group: str | None = Field(default=None, max_length=50)


class TeamRead(ORMModel):
    id: int
    organisation_id: int
    name: str
    age_group: str | None
    created_at: datetime


class MatchCreate(BaseModel):
    organisation_id: int
    home_team_id: int
    away_team_id: int
    match_date: date
    competition: str | None = Field(default=None, max_length=150)
    venue: str | None = Field(default=None, max_length=200)


class MatchRead(ORMModel):
    id: int
    organisation_id: int
    home_team_id: int
    away_team_id: int
    match_date: date
    competition: str | None
    venue: str | None
    created_at: datetime


class VideoAssetRead(ORMModel):
    id: int
    match_id: int
    original_filename: str
    content_type: str | None
    size_bytes: int
    created_at: datetime


class AnalysisJobCreate(BaseModel):
    match_id: int
    video_asset_id: int | None = None


class AnalysisJobUpdate(BaseModel):
    status: AnalysisStatus | None = None
    progress_percent: int | None = Field(default=None, ge=0, le=100)
    message: str | None = Field(default=None, max_length=1000)


class AnalysisJobRead(ORMModel):
    id: int
    match_id: int
    video_asset_id: int | None
    status: AnalysisStatus
    progress_percent: int
    message: str | None
    created_at: datetime
    updated_at: datetime
