from dataclasses import dataclass

from app.models import EventType, TimelineEvent


@dataclass(frozen=True)
class RugbyTaxonomyItem:
    id: str
    display_name: str
    category: str
    event_type: EventType
    outcome: str
    affects_score: bool = False
    score_points: int = 0
    creates_evidence: bool = True
    inferable: bool = True
    appears_in_reports: bool = True


RUGBY_TAXONOMY_V1: tuple[RugbyTaxonomyItem, ...] = (
    RugbyTaxonomyItem("carry", "Carry", "attack", EventType.carry, "carry"),
    RugbyTaxonomyItem("dominant_carry", "Dominant Carry", "attack", EventType.carry, "dominant carry"),
    RugbyTaxonomyItem("tackle", "Tackle", "defence", EventType.tackle, "tackle made"),
    RugbyTaxonomyItem("dominant_tackle", "Dominant Tackle", "defence", EventType.tackle, "dominant tackle"),
    RugbyTaxonomyItem("missed_tackle", "Missed Tackle", "defence", EventType.tackle, "missed tackle"),
    RugbyTaxonomyItem("line_break", "Line Break", "attack", EventType.carry, "line break"),
    RugbyTaxonomyItem("pass", "Pass", "attack", EventType.pass_event, "pass"),
    RugbyTaxonomyItem("kick", "Kick", "kicking", EventType.kick, "kick"),
    RugbyTaxonomyItem("ruck", "Ruck", "breakdown_ruck", EventType.ruck, "ruck"),
    RugbyTaxonomyItem("ruck_retained", "Ruck Retained", "breakdown_ruck", EventType.ruck, "ruck retained"),
    RugbyTaxonomyItem("ruck_lost", "Ruck Lost", "breakdown_ruck", EventType.ruck, "ruck lost"),
    RugbyTaxonomyItem("maul", "Maul", "set_piece", EventType.maul, "maul"),
    RugbyTaxonomyItem("maul_won", "Maul Won", "set_piece", EventType.maul, "maul won"),
    RugbyTaxonomyItem("maul_lost", "Maul Lost", "set_piece", EventType.maul, "maul lost"),
    RugbyTaxonomyItem("scrum", "Scrum", "set_piece", EventType.scrum, "scrum"),
    RugbyTaxonomyItem("scrum_won", "Scrum Won", "set_piece", EventType.scrum, "scrum won"),
    RugbyTaxonomyItem("scrum_lost", "Scrum Lost", "set_piece", EventType.scrum, "scrum lost"),
    RugbyTaxonomyItem("lineout", "Lineout", "set_piece", EventType.lineout, "lineout"),
    RugbyTaxonomyItem("lineout_won", "Lineout Won", "set_piece", EventType.lineout, "lineout won"),
    RugbyTaxonomyItem("lineout_lost", "Lineout Lost", "set_piece", EventType.lineout, "lineout lost"),
    RugbyTaxonomyItem("restart", "Restart", "restart", EventType.kickoff, "restart"),
    RugbyTaxonomyItem("restart_receipt", "Restart Receipt", "restart", EventType.kickoff, "restart receipt"),
    RugbyTaxonomyItem("exit", "Exit", "zone_territory", EventType.kick, "exit"),
    RugbyTaxonomyItem("zone_entry", "Zone Entry", "zone_territory", EventType.custom, "zone entry"),
    RugbyTaxonomyItem("turnover_won", "Turnover Won", "transition_turnover", EventType.turnover, "turnover won"),
    RugbyTaxonomyItem("turnover_conceded", "Turnover Conceded", "transition_turnover", EventType.turnover, "turnover conceded"),
    RugbyTaxonomyItem("penalty_won", "Penalty Won", "discipline", EventType.penalty, "penalty won"),
    RugbyTaxonomyItem("penalty_conceded", "Penalty Conceded", "discipline", EventType.penalty, "penalty conceded"),
    RugbyTaxonomyItem("penalty_type", "Penalty Type", "discipline", EventType.penalty, "penalty type"),
    RugbyTaxonomyItem("knock_on", "Knock On", "error", EventType.custom, "knock on"),
    RugbyTaxonomyItem("forward_pass", "Forward Pass", "error", EventType.pass_event, "forward pass"),
    RugbyTaxonomyItem("handling_error", "Handling Error", "error", EventType.custom, "handling error"),
    RugbyTaxonomyItem("try", "Try", "scoring", EventType.try_event, "try", True, 5),
    RugbyTaxonomyItem("conversion", "Conversion", "scoring", EventType.conversion, "conversion", True, 2),
    RugbyTaxonomyItem("penalty_goal", "Penalty Goal", "scoring", EventType.penalty, "penalty goal", True, 3),
    RugbyTaxonomyItem("drop_goal", "Drop Goal", "scoring", EventType.kick, "drop goal", True, 3),
    RugbyTaxonomyItem("card", "Card", "discipline", EventType.card, "card", False, 0, True, False),
    RugbyTaxonomyItem("stoppage", "Stoppage", "other", EventType.stoppage, "stoppage", False, 0, True, False),
)


def _normalise(value: str | None) -> str:
    return " ".join((value or "").replace("_", " ").split()).strip().lower()


def _item_terms(item: RugbyTaxonomyItem) -> set[str]:
    return {
        _normalise(item.id),
        _normalise(item.display_name),
        _normalise(item.outcome),
    }


def taxonomy_item_for_event(event: TimelineEvent) -> RugbyTaxonomyItem | None:
    outcome = _normalise(event.outcome)
    notes = _normalise(event.notes)
    field_zone = _normalise(event.field_zone)
    text = " ".join(part for part in [event.event_type.value, outcome, notes, field_zone] if part)
    for item in RUGBY_TAXONOMY_V1:
        if outcome and outcome in _item_terms(item):
            return item
    for item in RUGBY_TAXONOMY_V1:
        if event.event_type == item.event_type and any(term and term in text for term in _item_terms(item)):
            return item
    return None


def taxonomy_event_id(event: TimelineEvent) -> str:
    item = taxonomy_item_for_event(event)
    if item is not None:
        return item.id
    return event.event_type.value


def taxonomy_category(event: TimelineEvent) -> str:
    item = taxonomy_item_for_event(event)
    if item is not None:
        return item.category
    if event.event_type in {EventType.scrum, EventType.lineout, EventType.maul}:
        return "set_piece"
    if event.event_type == EventType.ruck:
        return "breakdown_ruck"
    if event.event_type in {EventType.kick, EventType.kickoff, EventType.conversion}:
        return "kicking"
    if event.event_type == EventType.penalty:
        return "discipline"
    if event.event_type == EventType.turnover:
        return "transition_turnover"
    if event.event_type == EventType.tackle:
        return "defence"
    if event.event_type in {EventType.carry, EventType.pass_event, EventType.try_event}:
        return "attack"
    return "other"
