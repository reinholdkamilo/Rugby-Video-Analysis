from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import AnalysisStatus, EvidenceType


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


class VideoProcessingResultRead(ORMModel):
    id: int
    analysis_job_id: int
    video_asset_id: int
    duration_seconds: float
    width: int
    height: int
    frame_rate: float
    video_codec: str | None
    audio_codec: str | None
    thumbnail_path: str
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


class EvidenceItemCreate(BaseModel):
    match_id: int
    video_asset_id: int | None = None
    timeline_event_id: int | None = None
    evidence_type: EvidenceType = EvidenceType.note
    label: str = Field(min_length=2, max_length=200)
    rugby_element: str | None = Field(default=None, max_length=150)
    source_uri: str | None = Field(default=None, max_length=2000)
    timestamp_seconds: float | None = Field(default=None, ge=0)
    confidence_label: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=4000)
    approved_for_training: bool = False


class EvidenceItemUpdate(BaseModel):
    video_asset_id: int | None = None
    timeline_event_id: int | None = None
    evidence_type: EvidenceType | None = None
    label: str | None = Field(default=None, min_length=2, max_length=200)
    rugby_element: str | None = Field(default=None, max_length=150)
    source_uri: str | None = Field(default=None, max_length=2000)
    timestamp_seconds: float | None = Field(default=None, ge=0)
    confidence_label: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=4000)
    approved_for_training: bool | None = None


class EvidenceItemRead(ORMModel):
    id: int
    match_id: int
    video_asset_id: int | None
    timeline_event_id: int | None
    evidence_type: EvidenceType
    label: str
    rugby_element: str | None
    source_uri: str | None
    timestamp_seconds: float | None
    confidence_label: str | None
    notes: str | None
    approved_for_training: bool
    created_at: datetime
    updated_at: datetime


class SeasonCreate(BaseModel):
    organisation_id: int
    name: str = Field(min_length=2, max_length=120)
    start_date: date | None = None
    end_date: date | None = None
    is_active: bool = True

    @model_validator(mode="after")
    def validate_dates(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("Season end date cannot be before the start date.")
        return self


class SeasonRead(ORMModel):
    id: int
    organisation_id: int
    name: str
    start_date: date | None
    end_date: date | None
    is_active: bool
    created_at: datetime


class CompetitionCreate(BaseModel):
    organisation_id: int
    season_id: int | None = None
    name: str = Field(min_length=2, max_length=150)
    level: str | None = Field(default=None, max_length=80)


class CompetitionRead(ORMModel):
    id: int
    organisation_id: int
    season_id: int | None
    name: str
    level: str | None
    created_at: datetime


class PlayerCreate(BaseModel):
    organisation_id: int
    team_id: int | None = None
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    preferred_name: str | None = Field(default=None, max_length=100)
    position: str | None = Field(default=None, max_length=50)
    jersey_number: int | None = Field(default=None, ge=1, le=99)
    is_active: bool = True


class PlayerRead(ORMModel):
    id: int
    organisation_id: int
    team_id: int | None
    first_name: str
    last_name: str
    preferred_name: str | None
    position: str | None
    jersey_number: int | None
    is_active: bool
    created_at: datetime


class MatchContextUpsert(BaseModel):
    season_id: int | None = None
    competition_id: int | None = None
    round_name: str | None = Field(default=None, max_length=100)


class MatchContextRead(ORMModel):
    id: int
    match_id: int
    season_id: int | None
    competition_id: int | None
    round_name: str | None
    created_at: datetime
    updated_at: datetime
