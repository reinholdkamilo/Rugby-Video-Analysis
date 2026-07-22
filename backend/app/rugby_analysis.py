from dataclasses import dataclass

from app.models import EventTeam, EventType, EvidenceItem, EvidenceType, TimelineEvent, VideoAsset
from app.rugby_taxonomy import taxonomy_item_for_event

EVENT_SOURCE_MANUAL = "manual"
EVENT_SOURCE_AUTO = "auto"
EVENT_SOURCE_LINKED = "linked_logic"
EVENT_SOURCE_INFERRED = "inferred"

TRUST_CONFIRMED = "confirmed"
TRUST_UNCONFIRMED = "unconfirmed"
TRUST_LINKED_UNCONFIRMED = "linked_unconfirmed"
TRUST_INFERRED_UNCONFIRMED = "inferred_unconfirmed"
TRUST_REJECTED = "rejected"

EVIDENCE_SOURCE_MANUAL = "manual_code"
EVIDENCE_SOURCE_UPLOAD = "uploaded_video"
EVIDENCE_SOURCE_AUTO = "auto_analysis"
EVIDENCE_SOURCE_LINKED = "linked_logic"
EVIDENCE_SOURCE_INFERRED = "inferred"

SCORING_OUTCOMES: dict[str, int] = {
    "try": 5,
    "conversion": 2,
    "penalty goal": 3,
    "penalty_goal": 3,
    "drop goal": 3,
    "drop_goal": 3,
}


def clean_label(value: str | None) -> str:
    return " ".join((value or "").replace("_", " ").split()).strip()


def scoring_points(event: TimelineEvent) -> int:
    taxonomy_item = taxonomy_item_for_event(event)
    if taxonomy_item is not None and taxonomy_item.affects_score:
        return taxonomy_item.score_points
    outcome = clean_label(event.outcome).lower()
    if event.event_type == EventType.try_event or outcome == "try":
        return 5
    if event.event_type == EventType.conversion or outcome == "conversion":
        return 2
    if event.event_type == EventType.penalty and outcome in {"goal", "penalty goal", "penalty kick goal"}:
        return 3
    if outcome == "drop goal":
        return 3
    return 0


def score_timeline(events: list[TimelineEvent]) -> dict:
    home = 0
    away = 0
    flow = []
    for event in sorted(events, key=lambda item: (item.start_seconds, item.id or 0)):
        points = scoring_points(event)
        if not points or event.team == EventTeam.neutral:
            continue
        if event.team == EventTeam.home:
            home += points
        elif event.team == EventTeam.away:
            away += points
        flow.append(
            {
                "event_id": event.id,
                "team": event.team.value,
                "event_type": event.event_type.value,
                "outcome": event.outcome,
                "timestamp_seconds": event.start_seconds,
                "points": points,
                "home_score": home,
                "away_score": away,
            }
        )
    return {"home_score": home, "away_score": away, "scoring_flow": flow}


def opposite_team(team: EventTeam) -> EventTeam:
    if team == EventTeam.home:
        return EventTeam.away
    if team == EventTeam.away:
        return EventTeam.home
    return EventTeam.neutral


@dataclass(frozen=True)
class LinkedEventCandidate:
    event_type: EventType
    team: EventTeam
    outcome: str
    reason: str


def linked_event_candidates(event: TimelineEvent) -> list[LinkedEventCandidate]:
    if event.team == EventTeam.neutral:
        return []
    opponent = opposite_team(event.team)
    outcome = clean_label(event.outcome).lower()
    candidates: list[LinkedEventCandidate] = []

    if event.event_type == EventType.tackle:
        carry_outcome = "negative carry" if "dominant" in outcome else "carry into contact"
        if "miss" in outcome:
            carry_outcome = "dominant carry"
        candidates.append(
            LinkedEventCandidate(
                event_type=EventType.carry,
                team=opponent,
                outcome=carry_outcome,
                reason=f"{event.team.value} tackle implies {opponent.value} carried the ball.",
            )
        )
    elif event.event_type == EventType.carry:
        tackle_outcome = "tackle made"
        if any(token in outcome for token in ["line break", "linebreak", "missed tackle", "tackle miss"]):
            tackle_outcome = "tackle missed"
        candidates.append(
            LinkedEventCandidate(
                event_type=EventType.tackle,
                team=opponent,
                outcome=tackle_outcome,
                reason=f"{event.team.value} carry implies {opponent.value} made a tackle attempt.",
            )
        )
    elif event.event_type == EventType.lineout and any(token in outcome for token in ["won", "win", "clean"]):
        candidates.append(
            LinkedEventCandidate(
                event_type=EventType.lineout,
                team=opponent,
                outcome="lineout lost",
                reason=f"{event.team.value} lineout won implies {opponent.value} lineout lost.",
            )
        )
    elif event.event_type == EventType.scrum and any(token in outcome for token in ["won", "win", "clean"]):
        candidates.append(
            LinkedEventCandidate(
                event_type=EventType.scrum,
                team=opponent,
                outcome="scrum lost",
                reason=f"{event.team.value} scrum won implies {opponent.value} scrum lost.",
            )
        )
    elif event.event_type == EventType.ruck and "jackal" in outcome and any(token in outcome for token in ["won", "win"]):
        candidates.append(
            LinkedEventCandidate(
                event_type=EventType.turnover,
                team=opponent,
                outcome="ruck possession lost",
                reason=f"{event.team.value} jackal win implies {opponent.value} lost ruck possession.",
            )
        )
    elif event.event_type == EventType.custom and "knock" in outcome:
        candidates.append(
            LinkedEventCandidate(
                event_type=EventType.turnover,
                team=opponent,
                outcome="scrum opportunity",
                reason=f"{event.team.value} knock-on implies {opponent.value} scrum or turnover opportunity.",
            )
        )
    elif event.event_type == EventType.try_event:
        candidates.append(
            LinkedEventCandidate(
                event_type=EventType.kickoff,
                team=opponent,
                outcome="restart pending",
                reason=f"{event.team.value} try implies restart to {opponent.value}.",
            )
        )
    return candidates


def event_evidence_label(event: TimelineEvent) -> str:
    label = clean_label(event.outcome) or event.event_type.value.replace("_", " ")
    return f"{event.team.value.title()} {label}"


def evidence_for_event(event: TimelineEvent, *, status: str | None = None, source: str | None = None) -> EvidenceItem:
    event_status = status or getattr(event, "trust_status", TRUST_CONFIRMED)
    event_source = source or getattr(event, "event_source", EVIDENCE_SOURCE_MANUAL)
    return EvidenceItem(
        match_id=event.match_id,
        video_asset_id=event.video_asset_id,
        timeline_event_id=event.id,
        evidence_type=EvidenceType.clip,
        label=event_evidence_label(event),
        rugby_element=event.event_type.value,
        source_uri=event.clip.file_path if event.clip is not None else None,
        timestamp_seconds=event.start_seconds,
        confidence_label=event_status,
        notes=event.notes,
        approved_for_training=False,
        status=event_status,
        source=event_source,
        trust_notes=getattr(event, "linked_reason", None),
    )


def evidence_for_video(video: VideoAsset) -> EvidenceItem:
    return EvidenceItem(
        match_id=video.match_id,
        video_asset_id=video.id,
        evidence_type=EvidenceType.video,
        label=f"Uploaded video: {video.original_filename}",
        rugby_element="source video",
        source_uri=video.storage_path,
        timestamp_seconds=None,
        confidence_label=TRUST_UNCONFIRMED,
        notes="Automatically created source evidence from match upload.",
        approved_for_training=False,
        status=TRUST_UNCONFIRMED,
        source=EVIDENCE_SOURCE_UPLOAD,
        trust_notes="Source evidence is available for review and future analysis.",
    )
