from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import EventTeam, EventType


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class TimelineEventCreate(BaseModel):
    match_id: int
    video_asset_id: int
    event_type: EventType
    team: EventTeam = EventTeam.neutral
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(gt=0)
    player_name: str | None = Field(default=None, max_length=150)
    outcome: str | None = Field(default=None, max_length=150)
    notes: str | None = Field(default=None, max_length=2000)
    phase_number: int | None = Field(default=None, ge=1)
    field_zone: str | None = Field(default=None, max_length=100)
    clip_requested: bool = True

    @model_validator(mode="after")
    def validate_timestamps(self):
        if self.end_seconds <= self.start_seconds:
            raise ValueError("End time must be later than start time.")
        if self.end_seconds - self.start_seconds > 300:
            raise ValueError("A single event clip cannot exceed five minutes.")
        return self


class TimelineEventUpdate(BaseModel):
    event_type: EventType | None = None
    team: EventTeam | None = None
    start_seconds: float | None = Field(default=None, ge=0)
    end_seconds: float | None = Field(default=None, gt=0)
    player_name: str | None = Field(default=None, max_length=150)
    outcome: str | None = Field(default=None, max_length=150)
    notes: str | None = Field(default=None, max_length=2000)
    phase_number: int | None = Field(default=None, ge=1)
    field_zone: str | None = Field(default=None, max_length=100)
    clip_requested: bool | None = None


class EventClipRead(ORMModel):
    id: int
    event_id: int
    duration_seconds: float
    file_path: str
    created_at: datetime


class TimelineEventRead(ORMModel):
    id: int
    match_id: int
    video_asset_id: int
    event_type: EventType
    team: EventTeam
    start_seconds: float
    end_seconds: float
    player_name: str | None
    outcome: str | None
    notes: str | None
    phase_number: int | None
    field_zone: str | None
    clip_requested: bool
    created_at: datetime
    updated_at: datetime
    clip: EventClipRead | None = None
