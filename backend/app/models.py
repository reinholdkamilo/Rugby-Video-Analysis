import enum
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AnalysisStatus(str, enum.Enum):
    queued = "queued"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class EventTeam(str, enum.Enum):
    home = "home"
    away = "away"
    neutral = "neutral"


class EventType(str, enum.Enum):
    kickoff = "kickoff"
    scrum = "scrum"
    lineout = "lineout"
    carry = "carry"
    tackle = "tackle"
    ruck = "ruck"
    maul = "maul"
    pass_event = "pass"
    kick = "kick"
    turnover = "turnover"
    penalty = "penalty"
    try_event = "try"
    conversion = "conversion"
    card = "card"
    stoppage = "stoppage"
    custom = "custom"


class SuggestionStatus(str, enum.Enum):
    pending = "pending"
    accepted = "accepted"
    rejected = "rejected"


class Organisation(Base):
    __tablename__ = "organisations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    teams: Mapped[list["Team"]] = relationship(back_populates="organisation", cascade="all, delete-orphan")


class Team(Base):
    __tablename__ = "teams"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(150), index=True)
    age_group: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    organisation: Mapped[Organisation] = relationship(back_populates="teams")


class Match(Base):
    __tablename__ = "matches"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"), index=True)
    home_team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    away_team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    match_date: Mapped[date] = mapped_column(Date)
    competition: Mapped[str | None] = mapped_column(String(150), nullable=True)
    venue: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    home_team: Mapped[Team] = relationship(foreign_keys=[home_team_id])
    away_team: Mapped[Team] = relationship(foreign_keys=[away_team_id])
    videos: Mapped[list["VideoAsset"]] = relationship(back_populates="match", cascade="all, delete-orphan")
    analysis_jobs: Mapped[list["AnalysisJob"]] = relationship(back_populates="match", cascade="all, delete-orphan")
    events: Mapped[list["TimelineEvent"]] = relationship(back_populates="match", cascade="all, delete-orphan")


class VideoAsset(Base):
    __tablename__ = "video_assets"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    stored_filename: Mapped[str] = mapped_column(String(255), unique=True)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    storage_path: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    match: Mapped[Match] = relationship(back_populates="videos")
    processing_result: Mapped["VideoProcessingResult | None"] = relationship(back_populates="video_asset", cascade="all, delete-orphan", uselist=False)


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    video_asset_id: Mapped[int | None] = mapped_column(ForeignKey("video_assets.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[AnalysisStatus] = mapped_column(Enum(AnalysisStatus), default=AnalysisStatus.queued, index=True)
    progress_percent: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
    match: Mapped[Match] = relationship(back_populates="analysis_jobs")
    video_asset: Mapped[VideoAsset | None] = relationship()
    processing_result: Mapped["VideoProcessingResult | None"] = relationship(back_populates="analysis_job", cascade="all, delete-orphan", uselist=False)


class VideoProcessingResult(Base):
    __tablename__ = "video_processing_results"
    id: Mapped[int] = mapped_column(primary_key=True)
    analysis_job_id: Mapped[int] = mapped_column(ForeignKey("analysis_jobs.id", ondelete="CASCADE"), unique=True, index=True)
    video_asset_id: Mapped[int] = mapped_column(ForeignKey("video_assets.id", ondelete="CASCADE"), unique=True, index=True)
    duration_seconds: Mapped[float] = mapped_column(Float)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    frame_rate: Mapped[float] = mapped_column(Float)
    video_codec: Mapped[str | None] = mapped_column(String(50), nullable=True)
    audio_codec: Mapped[str | None] = mapped_column(String(50), nullable=True)
    thumbnail_path: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    analysis_job: Mapped[AnalysisJob] = relationship(back_populates="processing_result")
    video_asset: Mapped[VideoAsset] = relationship(back_populates="processing_result")


class TimelineEvent(Base):
    __tablename__ = "timeline_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    video_asset_id: Mapped[int] = mapped_column(ForeignKey("video_assets.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[EventType] = mapped_column(Enum(EventType), index=True)
    team: Mapped[EventTeam] = mapped_column(Enum(EventTeam), default=EventTeam.neutral)
    start_seconds: Mapped[float] = mapped_column(Float)
    end_seconds: Mapped[float] = mapped_column(Float)
    player_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(150), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    phase_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    field_zone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    clip_requested: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
    match: Mapped[Match] = relationship(back_populates="events")
    video_asset: Mapped[VideoAsset] = relationship()
    clip: Mapped["EventClip | None"] = relationship(back_populates="event", cascade="all, delete-orphan", uselist=False)


class EventClip(Base):
    __tablename__ = "event_clips"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("timeline_events.id", ondelete="CASCADE"), unique=True, index=True)
    file_path: Mapped[str] = mapped_column(Text)
    duration_seconds: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    event: Mapped[TimelineEvent] = relationship(back_populates="clip")


class AutomaticEventSuggestion(Base):
    __tablename__ = "automatic_event_suggestions"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    video_asset_id: Mapped[int] = mapped_column(ForeignKey("video_assets.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[EventType] = mapped_column(Enum(EventType), index=True)
    team: Mapped[EventTeam] = mapped_column(Enum(EventTeam), default=EventTeam.neutral)
    start_seconds: Mapped[float] = mapped_column(Float)
    end_seconds: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float)
    label: Mapped[str] = mapped_column(String(200))
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[SuggestionStatus] = mapped_column(Enum(SuggestionStatus), default=SuggestionStatus.pending, index=True)
    timeline_event_id: Mapped[int | None] = mapped_column(ForeignKey("timeline_events.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
