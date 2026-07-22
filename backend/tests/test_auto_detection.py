from pathlib import Path
import subprocess
from types import SimpleNamespace

from app.auto_detection import build_candidates, build_scene_detection_command, detect_scene_changes, parse_scene_times
from app.models import EventType, SportType


def test_parse_scene_times_deduplicates_close_transitions() -> None:
    stderr = """
    [Parsed_showinfo_1] n:0 pts:10 pts_time:1.000
    [Parsed_showinfo_1] n:1 pts:15 pts_time:1.700
    [Parsed_showinfo_1] n:2 pts:40 pts_time:4.000
    """

    assert parse_scene_times(stderr) == [1.0, 4.0]


def test_scene_detection_command_samples_and_scales_video() -> None:
    command = build_scene_detection_command(
        Path("match.mp4"),
        threshold=0.35,
        sample_fps=1,
        analysis_width=480,
        max_scan_seconds=120,
    )

    assert command[:2] == ["ffmpeg", "-hide_banner"]
    assert "-nostdin" in command
    assert command[command.index("-threads") + 1] == "1"
    assert command[command.index("-t") + 1] == "120"
    assert command[command.index("-i") + 1] == "match.mp4"
    assert command[command.index("-vf") + 1] == "fps=1,scale=480:-2,select='gt(scene,0.35)',showinfo"


def test_scene_detection_command_accepts_remote_source() -> None:
    source = "https://example.test/match.mp4?signature=abc123"

    command = build_scene_detection_command(
        source,
        threshold=0.35,
        sample_fps=1,
        analysis_width=480,
        max_scan_seconds=0,
    )

    assert command[:2] == ["ffmpeg", "-hide_banner"]
    assert "-nostdin" in command
    assert command[command.index("-threads") + 1] == "1"
    assert command[command.index("-i") + 1] == source
    assert "-t" not in command


def test_detect_scene_changes_allows_remote_source(monkeypatch) -> None:
    calls: list[list[str]] = []

    def fake_run(command: list[str], **_kwargs: object) -> SimpleNamespace:
        calls.append(command)
        return SimpleNamespace(returncode=0, stderr="[showinfo] pts_time:12.500")

    monkeypatch.setattr("app.auto_detection.subprocess.run", fake_run)

    result = detect_scene_changes("https://example.test/match.mp4?signature=abc123", threshold=0.35)

    assert result == [12.5]
    assert calls[0][calls[0].index("-i") + 1].startswith("https://example.test/match.mp4")


def test_detect_scene_changes_maps_subprocess_timeout(monkeypatch) -> None:
    def fake_run(*_args: object, **_kwargs: object) -> SimpleNamespace:
        raise subprocess.TimeoutExpired(cmd="ffmpeg", timeout=45)

    monkeypatch.setattr("app.auto_detection.subprocess.run", fake_run)

    try:
        detect_scene_changes("https://example.test/match.mp4")
    except TimeoutError:
        pass
    else:
        raise AssertionError("Expected TimeoutError")


def test_build_candidates_creates_opening_restart_and_review_items() -> None:
    candidates = build_candidates(60.0, [5.0, 30.0, 35.0])

    assert candidates[0].event_type == EventType.kickoff
    assert candidates[0].start_seconds == 0.0
    assert any(candidate.event_type == EventType.stoppage for candidate in candidates)
    assert all(candidate.end_seconds <= 60.0 for candidate in candidates)
    assert all(0 <= candidate.confidence <= 1 for candidate in candidates)


def test_build_candidates_uses_sport_context_labels() -> None:
    afl_candidates = build_candidates(90.0, [30.0], SportType.afl)
    league_candidates = build_candidates(90.0, [30.0], SportType.rugby_league)

    assert afl_candidates[0].label == "Opening bounce or kick-in candidate"
    assert "AFL" in afl_candidates[0].reason
    assert league_candidates[0].label == "Opening kickoff or set-start candidate"
    assert "Rugby League" in league_candidates[0].reason
