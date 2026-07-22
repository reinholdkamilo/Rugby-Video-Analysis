import json
from dataclasses import dataclass

from app.models import EventTeam, EventType, TimelineEvent
from app.rugby_analysis import clean_label, opposite_team
from app.rugby_taxonomy import taxonomy_event_id

EVENT_SOURCE_INFERRED = "inferred"
TRUST_INFERRED_UNCONFIRMED = "inferred_unconfirmed"
TRUST_STALE = "stale"

SOURCE_EVENT_SOURCES_TO_SKIP = {"inferred", "linked_logic"}
SOURCE_TRUST_STATUSES_TO_SKIP = {"rejected", "stale"}
NO_INFER_SCORE_EVENT_TYPES = {EventType.try_event, EventType.conversion}
NO_INFER_SCORE_OUTCOMES = {"try", "conversion", "penalty goal", "drop goal"}


@dataclass(frozen=True)
class InferenceCandidate:
    event_type: EventType
    team: EventTeam
    start_seconds: float
    end_seconds: float
    outcome: str
    rule: str
    reason: str
    source_event_ids: tuple[int, ...]
    confidence: float
    linked_event_id: int | None = None
    field_zone: str | None = None

    @property
    def source_json(self) -> str:
        return json.dumps(list(self.source_event_ids), separators=(",", ":"))


def inference_source_ids(event: TimelineEvent) -> list[int]:
    if event.created_from_event_ids:
        try:
            parsed = json.loads(event.created_from_event_ids)
        except json.JSONDecodeError:
            return []
        if isinstance(parsed, list):
            return [int(item) for item in parsed if isinstance(item, int)]
    return []


def is_inferred_event(event: TimelineEvent) -> bool:
    return event.event_source in {"inferred", "linked_logic"}


def is_source_event(event: TimelineEvent) -> bool:
    return (
        event.id is not None
        and event.event_source not in SOURCE_EVENT_SOURCES_TO_SKIP
        and event.trust_status not in SOURCE_TRUST_STATUSES_TO_SKIP
    )


def _norm(value: str | None) -> str:
    return clean_label(value).lower()


def _window_around(center: float, duration: float = 10.0) -> tuple[float, float]:
    start = max(0.0, center - duration / 2)
    return round(start, 2), round(start + duration, 2)


def _same_event(a: TimelineEvent, candidate: InferenceCandidate, tolerance: float = 2.0) -> bool:
    return (
        a.team == candidate.team
        and a.event_type == candidate.event_type
        and _norm(a.outcome) == _norm(candidate.outcome)
        and abs(a.start_seconds - candidate.start_seconds) <= tolerance
    )


def _nearby_exists(events: list[TimelineEvent], candidate: InferenceCandidate, tolerance: float = 2.0) -> bool:
    return any(_same_event(event, candidate, tolerance) for event in events if event.trust_status not in {"rejected", TRUST_STALE})


def immediate_inference_candidates(event: TimelineEvent, existing_events: list[TimelineEvent] | None = None) -> list[InferenceCandidate]:
    if not is_source_event(event) or event.team == EventTeam.neutral:
        return []
    outcome = _norm(event.outcome)
    taxonomy_id = taxonomy_event_id(event)
    opponent = opposite_team(event.team)
    start = round(event.start_seconds, 2)
    end = round(event.end_seconds, 2)
    source_id = int(event.id)
    candidates: list[InferenceCandidate] = []

    def add(
        *,
        event_type: EventType,
        team: EventTeam,
        outcome: str,
        rule: str,
        reason: str,
        confidence: float,
    ) -> None:
        candidates.append(
            InferenceCandidate(
                event_type=event_type,
                team=team,
                start_seconds=start,
                end_seconds=end,
                outcome=outcome,
                rule=rule,
                reason=reason,
                source_event_ids=(source_id,),
                linked_event_id=source_id,
                confidence=confidence,
                field_zone=event.field_zone,
            )
        )

    if event.event_type == EventType.tackle:
        if "miss" in outcome or taxonomy_id == "missed_tackle":
            add(
                event_type=EventType.carry,
                team=opponent,
                outcome="dominant carry",
                rule="missed_tackle_implies_opposition_dominant_carry",
                reason=f"{event.team.value} missed tackle implies {opponent.value} made a dominant carry.",
                confidence=0.82,
            )
        else:
            add(
                event_type=EventType.carry,
                team=opponent,
                outcome="carry",
                rule="tackle_implies_opposition_carry",
                reason=f"{event.team.value} tackle implies {opponent.value} carried the ball.",
                confidence=0.9,
            )
    elif taxonomy_id == "line_break":
        add(
            event_type=EventType.tackle,
            team=opponent,
            outcome="missed tackle",
            rule="line_break_implies_opposition_missed_tackle",
            reason=f"{event.team.value} line break usually implies {opponent.value} missed a tackle.",
            confidence=0.72,
        )
    elif taxonomy_id == "penalty_conceded":
        add(
            event_type=EventType.penalty,
            team=opponent,
            outcome="penalty won",
            rule="penalty_conceded_mirrors_penalty_won",
            reason=f"{event.team.value} penalty conceded is a penalty won by {opponent.value}.",
            confidence=0.97,
        )
    elif taxonomy_id == "penalty_won":
        add(
            event_type=EventType.penalty,
            team=opponent,
            outcome="penalty conceded",
            rule="penalty_won_mirrors_penalty_conceded",
            reason=f"{event.team.value} penalty won is a penalty conceded by {opponent.value}.",
            confidence=0.97,
        )
    elif taxonomy_id in {"knock_on", "forward_pass"}:
        add(
            event_type=EventType.custom,
            team=event.team,
            outcome="handling error",
            rule="technical_error_implies_handling_error",
            reason=f"{clean_label(event.outcome) or event.event_type.value} is counted as a handling error.",
            confidence=0.96,
        )
    elif taxonomy_id in {"lineout_lost", "scrum_lost", "maul_lost"}:
        event_type = event.event_type
        label = taxonomy_id.replace("_lost", " won").replace("_", " ")
        add(
            event_type=event_type,
            team=opponent,
            outcome=label,
            rule=f"{taxonomy_id}_mirrors_opposition_won",
            reason=f"{event.team.value} {taxonomy_id.replace('_', ' ')} implies {opponent.value} won that contest.",
            confidence=0.95,
        )

    if existing_events is not None:
        candidates = [candidate for candidate in candidates if not _nearby_exists(existing_events, candidate)]
    return candidates


def sequence_inference_candidates(events: list[TimelineEvent]) -> list[InferenceCandidate]:
    source_events = [event for event in events if is_source_event(event)]
    source_events.sort(key=lambda event: (event.start_seconds, event.id or 0))
    candidates: list[InferenceCandidate] = []

    for previous, current in zip(source_events, source_events[1:], strict=False):
        if previous.team == EventTeam.neutral or current.team == EventTeam.neutral:
            continue
        previous_taxonomy = taxonomy_event_id(previous)
        current_outcome = _norm(current.outcome)
        source_ids = (int(previous.id), int(current.id))
        center = (previous.start_seconds + current.start_seconds) / 2
        start, end = _window_around(center)

        def add(event_type: EventType, team: EventTeam, outcome: str, rule: str, reason: str, confidence: float) -> None:
            candidates.append(
                InferenceCandidate(
                    event_type=event_type,
                    team=team,
                    start_seconds=start,
                    end_seconds=end,
                    outcome=outcome,
                    rule=rule,
                    reason=reason,
                    source_event_ids=source_ids,
                    linked_event_id=int(previous.id),
                    confidence=confidence,
                    field_zone=current.field_zone or previous.field_zone,
                )
            )

        if previous.team == current.team and previous.event_type == EventType.carry and current.event_type == EventType.carry:
            add(
                EventType.ruck,
                previous.team,
                "ruck retained",
                "same_team_carry_sequence_implies_ruck_retained",
                f"{previous.team.value} carried twice in sequence, so possession was probably retained at the ruck.",
                0.78,
            )
        if previous.team == current.team and previous.event_type == EventType.tackle and current.event_type == EventType.tackle:
            attacking_team = opposite_team(previous.team)
            add(
                EventType.ruck,
                attacking_team,
                "ruck retained",
                "same_team_tackle_sequence_implies_opposition_ruck_retained",
                f"{previous.team.value} made consecutive tackles, so {attacking_team.value} probably retained ruck possession.",
                0.76,
            )
        if previous.event_type == EventType.carry and current.event_type == EventType.carry and previous.team != current.team:
            add(
                EventType.ruck,
                previous.team,
                "ruck lost",
                "carry_possession_switch_implies_ruck_lost",
                f"Possession switched after a {previous.team.value} carry, so that team likely lost the ruck.",
                0.72,
            )
            add(
                EventType.turnover,
                current.team,
                "turnover won",
                "carry_possession_switch_implies_turnover_won",
                f"{current.team.value} appears to have gained possession after the opposition carry.",
                0.72,
            )
        if previous_taxonomy == "ruck_lost" and previous.team != current.team and current.event_type not in NO_INFER_SCORE_EVENT_TYPES and current_outcome not in NO_INFER_SCORE_OUTCOMES:
            add(
                EventType.turnover,
                current.team,
                "turnover won",
                "ruck_lost_followed_by_opposition_possession",
                f"{previous.team.value} ruck lost is a turnover won by {current.team.value}.",
                0.86,
            )

    return [candidate for candidate in candidates if not _nearby_exists(events, candidate)]


def infer_events(events: list[TimelineEvent]) -> list[InferenceCandidate]:
    candidates: list[InferenceCandidate] = []
    for event in events:
        candidates.extend(immediate_inference_candidates(event, events))
    candidates.extend(sequence_inference_candidates(events))

    deduped: dict[tuple[str, str, str, str, tuple[int, ...]], InferenceCandidate] = {}
    for candidate in candidates:
        key = (
            candidate.team.value,
            candidate.event_type.value,
            _norm(candidate.outcome),
            candidate.rule,
            candidate.source_event_ids,
        )
        deduped[key] = candidate
    return list(deduped.values())
