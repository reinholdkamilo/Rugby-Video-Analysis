from app.auto_detection import build_candidates, parse_scene_times
from app.models import EventType


def test_parse_scene_times_deduplicates_close_transitions() -> None:
    stderr = """
    [Parsed_showinfo_1] n:0 pts:10 pts_time:1.000
    [Parsed_showinfo_1] n:1 pts:15 pts_time:1.700
    [Parsed_showinfo_1] n:2 pts:40 pts_time:4.000
    """

    assert parse_scene_times(stderr) == [1.0, 4.0]


def test_build_candidates_creates_opening_restart_and_review_items() -> None:
    candidates = build_candidates(60.0, [5.0, 30.0, 35.0])

    assert candidates[0].event_type == EventType.kickoff
    assert candidates[0].start_seconds == 0.0
    assert any(candidate.event_type == EventType.stoppage for candidate in candidates)
    assert all(candidate.end_seconds <= 60.0 for candidate in candidates)
    assert all(0 <= candidate.confidence <= 1 for candidate in candidates)
