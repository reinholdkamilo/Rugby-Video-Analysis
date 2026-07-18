from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import EventTeam, Match, TimelineEvent
from app.rugby_analysis import score_timeline, scoring_points

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _events_for_match(match_id: int, video_asset_id: int | None, db: Session) -> list[TimelineEvent]:
    if db.get(Match, match_id) is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    statement = select(TimelineEvent).where(TimelineEvent.match_id == match_id).order_by(
        TimelineEvent.start_seconds,
        TimelineEvent.id,
    )
    if video_asset_id is not None:
        statement = statement.where(TimelineEvent.video_asset_id == video_asset_id)
    return list(db.scalars(statement))


def _team_counts(events: list[TimelineEvent], team: EventTeam) -> dict[str, int]:
    team_events = [event for event in events if event.team == team]
    return {
        "events": len(team_events),
        "carries": sum(event.event_type.value == "carry" for event in team_events),
        "tackles": sum(event.event_type.value == "tackle" for event in team_events),
        "rucks": sum(event.event_type.value == "ruck" for event in team_events),
        "kicks": sum(event.event_type.value in {"kick", "kickoff", "conversion"} for event in team_events),
        "set_piece": sum(event.event_type.value in {"scrum", "lineout", "maul"} for event in team_events),
        "penalties": sum(event.event_type.value == "penalty" for event in team_events),
        "turnovers": sum(event.event_type.value == "turnover" for event in team_events),
        "points": sum(scoring_points(event) for event in team_events),
    }


def _quality_flags(events: list[TimelineEvent]) -> list[dict[str, object]]:
    flags: list[dict[str, object]] = []
    for event in events:
        if event.team == EventTeam.neutral and event.event_type.value not in {"stoppage", "kickoff"}:
            flags.append({"event_id": event.id, "severity": "warning", "message": "Event has neutral team."})
        if not event.field_zone:
            flags.append({"event_id": event.id, "severity": "info", "message": "Event has no field zone."})
        if event.event_type.value in {"carry", "tackle", "ruck", "kick", "penalty"} and not event.outcome:
            flags.append({"event_id": event.id, "severity": "info", "message": "Event has no rugby outcome."})
        if event.event_type.value == "penalty" and scoring_points(event) == 0 and (event.outcome or "").lower() in {"goal", "shot"}:
            flags.append({"event_id": event.id, "severity": "warning", "message": "Penalty looks like a shot at goal but did not score."})
        if getattr(event, "trust_status", "confirmed") != "confirmed":
            flags.append({"event_id": event.id, "severity": "review", "message": f"Event is {event.trust_status}."})
    for previous, current in zip(events, events[1:], strict=False):
        if current.start_seconds - previous.end_seconds > 180:
            flags.append(
                {
                    "event_id": current.id,
                    "severity": "info",
                    "message": "Long timeline gap before this event.",
                }
            )
    return flags


@router.get("/matches/{match_id}/metrics")
def match_report_metrics(
    match_id: int,
    video_asset_id: int | None = None,
    db: Session = Depends(get_db),
) -> dict:
    events = _events_for_match(match_id, video_asset_id, db)
    scoring = score_timeline(events)
    return {
        **scoring,
        "event_count": len(events),
        "confirmed_event_count": sum(getattr(event, "trust_status", "confirmed") == "confirmed" for event in events),
        "unconfirmed_event_count": sum(getattr(event, "trust_status", "confirmed") != "confirmed" for event in events),
        "home": _team_counts(events, EventTeam.home),
        "away": _team_counts(events, EventTeam.away),
        "quality_flags": _quality_flags(events),
    }
