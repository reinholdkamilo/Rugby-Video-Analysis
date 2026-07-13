from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from statistics import mean

from app.models import RugbyUnderstandingObservation


@dataclass
class IntelligenceMoment:
    timestamp_seconds: float
    match_state: str
    side_candidate: str
    field_zone: str
    estimated_players: int
    activity_level: float
    confidence: float


@dataclass
class IntelligenceSequence:
    start_seconds: float
    end_seconds: float
    match_state: str
    side_candidate: str
    sample_count: int
    average_activity: float
    confidence: float


def _classify_state(observation: RugbyUnderstandingObservation) -> tuple[str, float]:
    players = observation.estimated_players
    activity = observation.activity_level
    zone = observation.field_zone

    if zone == "off-field":
        return "stoppage_or_replay", 0.62
    if zone == "tight-field" and players >= 14 and activity < 0.075:
        return "set_piece_or_reset", 0.66
    if zone == "tight-field" and activity >= 0.075:
        return "contact_phase", 0.64
    if zone == "wide-field" and activity >= 0.065:
        return "open_play", 0.68
    if zone == "wide-field" and players >= 10:
        return "structured_shape", 0.61
    if activity < 0.03:
        return "low_activity_reset", 0.56
    return "transition", 0.52


def build_intelligence_report(observations: list[RugbyUnderstandingObservation]) -> dict:
    if not observations:
        raise ValueError("Run Stage 6 rugby understanding before Stage 7 intelligence.")

    moments: list[IntelligenceMoment] = []
    for observation in observations:
        state, state_confidence = _classify_state(observation)
        confidence = min(0.95, (state_confidence + observation.confidence) / 2)
        moments.append(IntelligenceMoment(
            timestamp_seconds=observation.timestamp_seconds,
            match_state=state,
            side_candidate=observation.possession_side_candidate,
            field_zone=observation.field_zone,
            estimated_players=observation.estimated_players,
            activity_level=observation.activity_level,
            confidence=round(confidence, 3),
        ))

    sequences: list[IntelligenceSequence] = []
    current: list[IntelligenceMoment] = []
    for moment in moments:
        if not current:
            current = [moment]
            continue
        previous = current[-1]
        same_state = moment.match_state == previous.match_state
        compatible_side = moment.side_candidate == previous.side_candidate or "unknown" in {moment.side_candidate, previous.side_candidate}
        close_in_time = moment.timestamp_seconds - previous.timestamp_seconds <= 8.0
        if same_state and compatible_side and close_in_time:
            current.append(moment)
            continue
        sequences.append(_sequence_from_moments(current))
        current = [moment]
    if current:
        sequences.append(_sequence_from_moments(current))

    state_counts = Counter(moment.match_state for moment in moments)
    side_counts = Counter(moment.side_candidate for moment in moments if moment.side_candidate != "unknown")
    zone_counts = Counter(moment.field_zone for moment in moments)
    dominant_colours = Counter()
    for observation in observations:
        if observation.dominant_team_colour_1:
            dominant_colours[observation.dominant_team_colour_1] += 1
        if observation.dominant_team_colour_2:
            dominant_colours[observation.dominant_team_colour_2] += 1

    high_activity = [moment for moment in moments if moment.activity_level >= 0.08]
    top_colours = [colour for colour, _ in dominant_colours.most_common(4)]

    return {
        "video_asset_id": observations[0].video_asset_id,
        "match_id": observations[0].match_id,
        "sample_count": len(moments),
        "average_players": round(mean(moment.estimated_players for moment in moments), 1),
        "average_activity": round(mean(moment.activity_level for moment in moments), 4),
        "high_activity_samples": len(high_activity),
        "state_counts": dict(state_counts),
        "side_counts": dict(side_counts),
        "field_zone_counts": dict(zone_counts),
        "stabilised_colour_candidates": top_colours,
        "moments": [moment.__dict__ for moment in moments],
        "sequences": [sequence.__dict__ for sequence in sequences],
        "limitations": [
            "Match states are evidence-based candidates, not confirmed rugby events.",
            "Side candidates describe visual player concentration and are not confirmed possession.",
            "Team colours require analyst confirmation before team assignment.",
        ],
    }


def _sequence_from_moments(moments: list[IntelligenceMoment]) -> IntelligenceSequence:
    side_counts = Counter(moment.side_candidate for moment in moments if moment.side_candidate != "unknown")
    side = side_counts.most_common(1)[0][0] if side_counts else "unknown"
    return IntelligenceSequence(
        start_seconds=moments[0].timestamp_seconds,
        end_seconds=moments[-1].timestamp_seconds,
        match_state=moments[0].match_state,
        side_candidate=side,
        sample_count=len(moments),
        average_activity=round(mean(moment.activity_level for moment in moments), 4),
        confidence=round(mean(moment.confidence for moment in moments), 3),
    )
