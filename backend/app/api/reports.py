from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import EventTeam, Match, TimelineEvent
from app.rugby_analysis import score_timeline, scoring_points
from app.rugby_taxonomy import taxonomy_category, taxonomy_event_id

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
    taxonomy_ids = [taxonomy_event_id(event) for event in team_events]
    taxonomy_categories = [taxonomy_category(event) for event in team_events]
    return {
        "events": len(team_events),
        "carries": sum(item in {"carry", "dominant_carry"} for item in taxonomy_ids),
        "dominant_carries": sum(item == "dominant_carry" for item in taxonomy_ids),
        "tackles": sum(item in {"tackle", "dominant_tackle"} for item in taxonomy_ids),
        "dominant_tackles": sum(item == "dominant_tackle" for item in taxonomy_ids),
        "missed_tackles": sum(item == "missed_tackle" for item in taxonomy_ids),
        "line_breaks": sum(item == "line_break" for item in taxonomy_ids),
        "passes": sum(item == "pass" for item in taxonomy_ids),
        "rucks": sum(category == "breakdown_ruck" for category in taxonomy_categories),
        "kicks": sum(item in {"kick", "exit", "drop_goal"} or category == "kicking" for item, category in zip(taxonomy_ids, taxonomy_categories, strict=False)),
        "set_piece": sum(category == "set_piece" for category in taxonomy_categories),
        "scrums": sum(item.startswith("scrum") for item in taxonomy_ids),
        "lineouts": sum(item.startswith("lineout") for item in taxonomy_ids),
        "mauls": sum(item.startswith("maul") for item in taxonomy_ids),
        "penalties": sum(item.startswith("penalty") for item in taxonomy_ids),
        "penalties_won": sum(item == "penalty_won" for item in taxonomy_ids),
        "penalties_conceded": sum(item == "penalty_conceded" for item in taxonomy_ids),
        "turnovers": sum(item.startswith("turnover") for item in taxonomy_ids),
        "turnovers_won": sum(item == "turnover_won" for item in taxonomy_ids),
        "turnovers_conceded": sum(item == "turnover_conceded" for item in taxonomy_ids),
        "errors": sum(category == "error" for category in taxonomy_categories),
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
