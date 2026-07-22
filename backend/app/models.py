import enum
import json
from datetime import date, datetime, timezone

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Enum, Float, ForeignKey, Integer, String, Text
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


class EvidenceType(str, enum.Enum):
    video = "video"
    clip = "clip"
    frame = "frame"
    audio = "audio"
    referee_audio = "referee_audio"
    scoreboard = "scoreboard"
    commentary = "commentary"
    note = "note"
    other = "other"


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
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    storage_path: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    match: Mapped[Match] = relationship(back_populates="videos")
    processing_result: Mapped["VideoProcessingResult | None"] = relationship(back_populates="video_asset", cascade="all, delete-orphan", uselist=False)


class MultipartUploadSession(Base):
    __tablename__ = "multipart_upload_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    upload_id: Mapped[str] = mapped_column(Text, unique=True)
    object_key: Mapped[str] = mapped_column(Text, unique=True)
    filename: Mapped[str] = mapped_column(String(255), index=True)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, index=True)
    part_size: Mapped[int] = mapped_column(Integer)
    total_parts: Mapped[int] = mapped_column(Integer)
    uploaded_parts_json: Mapped[str] = mapped_column(Text, default="[]")
    status: Mapped[str] = mapped_column(String(32), default="uploading", index=True)
    video_asset_id: Mapped[int | None] = mapped_column(ForeignKey("video_assets.id", ondelete="SET NULL"), nullable=True)
    analysis_job_id: Mapped[int | None] = mapped_column(ForeignKey("analysis_jobs.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    @property
    def uploaded_parts(self) -> list[dict[str, object]]:
        try:
            parsed = json.loads(self.uploaded_parts_json or "[]")
        except json.JSONDecodeError:
            return []
        if not isinstance(parsed, list):
            return []
        return [part for part in parsed if isinstance(part, dict)]

    def set_uploaded_parts(self, parts: list[dict[str, object]]) -> None:
        cleaned = [
            {"part_number": int(part["part_number"]), "etag": str(part["etag"])}
            for part in sorted(parts, key=lambda item: int(item["part_number"]))
        ]
        self.uploaded_parts_json = json.dumps(cleaned)


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
    event_source: Mapped[str] = mapped_column(String(40), default="manual", index=True)
    trust_status: Mapped[str] = mapped_column(String(40), default="confirmed", index=True)
    linked_event_id: Mapped[int | None] = mapped_column(ForeignKey("timeline_events.id", ondelete="SET NULL"), nullable=True, index=True)
    linked_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    inference_rule: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    created_from_event_ids: Mapped[str | None] = mapped_column(Text, nullable=True)
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


class EvidenceItem(Base):
    __tablename__ = "evidence_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    video_asset_id: Mapped[int | None] = mapped_column(ForeignKey("video_assets.id", ondelete="SET NULL"), nullable=True, index=True)
    timeline_event_id: Mapped[int | None] = mapped_column(ForeignKey("timeline_events.id", ondelete="SET NULL"), nullable=True, index=True)
    evidence_type: Mapped[EvidenceType] = mapped_column(Enum(EvidenceType), default=EvidenceType.note, index=True)
    label: Mapped[str] = mapped_column(String(200), index=True)
    rugby_element: Mapped[str | None] = mapped_column(String(150), nullable=True, index=True)
    source_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    timestamp_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence_label: Mapped[str | None] = mapped_column(String(40), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_for_training: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    status: Mapped[str] = mapped_column(String(40), default="unconfirmed", index=True)
    source: Mapped[str] = mapped_column(String(40), default="manual", index=True)
    trust_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class VisionFrameObservation(Base):
    __tablename__ = "vision_frame_observations"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    video_asset_id: Mapped[int] = mapped_column(ForeignKey("video_assets.id", ondelete="CASCADE"), index=True)
    timestamp_seconds: Mapped[float] = mapped_column(Float, index=True)
    frame_path: Mapped[str] = mapped_column(Text)
    field_green_ratio: Mapped[float] = mapped_column(Float)
    field_visible: Mapped[bool] = mapped_column(Boolean, default=False)
    scoreboard_region: Mapped[str | None] = mapped_column(Text, nullable=True)
    scoreboard_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    brightness: Mapped[float] = mapped_column(Float)
    motion_score: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class RugbyUnderstandingObservation(Base):
    __tablename__ = "rugby_understanding_observations"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    video_asset_id: Mapped[int] = mapped_column(ForeignKey("video_assets.id", ondelete="CASCADE"), index=True)
    timestamp_seconds: Mapped[float] = mapped_column(Float, index=True)
    estimated_players: Mapped[int] = mapped_column(Integer, default=0)
    dominant_team_colour_1: Mapped[str | None] = mapped_column(String(32), nullable=True)
    dominant_team_colour_2: Mapped[str | None] = mapped_column(String(32), nullable=True)
    field_zone: Mapped[str] = mapped_column(String(32), default="unknown")
    activity_level: Mapped[float] = mapped_column(Float, default=0.0)
    possession_side_candidate: Mapped[str] = mapped_column(String(16), default="unknown")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    source_frame_path: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Season(Base):
    __tablename__ = "seasons"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Competition(Base):
    __tablename__ = "competitions"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"), index=True)
    season_id: Mapped[int | None] = mapped_column(ForeignKey("seasons.id", ondelete="SET NULL"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(150), index=True)
    level: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Player(Base):
    __tablename__ = "players"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[int] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"), index=True)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100), index=True)
    preferred_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    position: Mapped[str | None] = mapped_column(String(50), nullable=True)
    jersey_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class MatchContext(Base):
    __tablename__ = "match_contexts"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), unique=True, index=True)
    season_id: Mapped[int | None] = mapped_column(ForeignKey("seasons.id", ondelete="SET NULL"), nullable=True, index=True)
    competition_id: Mapped[int | None] = mapped_column(ForeignKey("competitions.id", ondelete="SET NULL"), nullable=True, index=True)
    round_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
