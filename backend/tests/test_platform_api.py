from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import EventClip, VideoAsset


def test_create_match_and_analysis_job() -> None:
    unique = uuid4().hex[:8]
    with TestClient(app) as client:
        organisation = client.post(
            "/api/organisations", json={"name": f"Brumbies {unique}"}
        )
        assert organisation.status_code == 201
        organisation_id = organisation.json()["id"]

        home = client.post(
            "/api/teams",
            json={
                "organisation_id": organisation_id,
                "name": f"Home {unique}",
                "age_group": "U16",
            },
        )
        away = client.post(
            "/api/teams",
            json={
                "organisation_id": organisation_id,
                "name": f"Away {unique}",
                "age_group": "U16",
            },
        )
        assert home.status_code == 201
        assert away.status_code == 201

        match = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": home.json()["id"],
                "away_team_id": away.json()["id"],
                "match_date": "2026-07-12",
                "competition": "Foundation Test",
                "venue": "Brumbies HQ",
            },
        )
        assert match.status_code == 201

        job = client.post(
            "/api/analysis-jobs", json={"match_id": match.json()["id"]}
        )
        assert job.status_code == 201
        assert job.json()["status"] == "queued"
        assert job.json()["progress_percent"] == 0

        updated = client.patch(
            f"/api/analysis-jobs/{job.json()['id']}",
            json={"status": "processing", "progress_percent": 25},
        )
        assert updated.status_code == 200
        assert updated.json()["status"] == "processing"
        assert updated.json()["progress_percent"] == 25


def test_large_temporary_upload_session_is_rejected() -> None:
    unique = uuid4().hex[:8]
    with TestClient(app) as client:
        organisation_id = client.post(
            "/api/organisations", json={"name": f"Upload Limit {unique}"}
        ).json()["id"]
        home_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Home {unique}"},
        ).json()["id"]
        away_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Away {unique}"},
        ).json()["id"]
        match_id = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "match_date": "2026-07-12",
            },
        ).json()["id"]

        response = client.post(
            "/api/uploads",
            json={
                "match_id": match_id,
                "filename": "full-match.mp4",
                "content_type": "video/mp4",
                "size_bytes": 101 * 1024 * 1024,
                "chunk_size": 4 * 1024 * 1024,
            },
        )

    assert response.status_code == 413
    assert "persistent object storage" in response.json()["detail"]


def test_delete_match_before_deleting_teams() -> None:
    unique = uuid4().hex[:8]
    with TestClient(app) as client:
        organisation_id = client.post(
            "/api/organisations", json={"name": f"Delete Flow {unique}"}
        ).json()["id"]
        home_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Home {unique}"},
        ).json()["id"]
        away_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Away {unique}"},
        ).json()["id"]
        match_id = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "match_date": "2026-07-12",
            },
        ).json()["id"]

        blocked = client.delete(f"/api/teams/{home_id}")
        assert blocked.status_code == 409

        deleted_match = client.delete(f"/api/matches/{match_id}")
        assert deleted_match.status_code == 204
        assert client.get(f"/api/matches/{match_id}").status_code == 404

        deleted_home = client.delete(f"/api/teams/{home_id}")
        deleted_away = client.delete(f"/api/teams/{away_id}")
        assert deleted_home.status_code == 204
        assert deleted_away.status_code == 204


def test_delete_timeline_event_removes_it_from_timeline() -> None:
    unique = uuid4().hex[:8]
    with TestClient(app) as client:
        organisation_id = client.post(
            "/api/organisations", json={"name": f"Timeline Delete {unique}"}
        ).json()["id"]
        home_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Home {unique}"},
        ).json()["id"]
        away_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Away {unique}"},
        ).json()["id"]
        match_id = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "match_date": "2026-07-12",
            },
        ).json()["id"]
        video = client.post(
            f"/api/matches/{match_id}/videos",
            files={"file": ("sample.mp4", b"not a real video", "video/mp4")},
        ).json()
        event = client.post(
            "/api/timeline-events",
            json={
                "match_id": match_id,
                "video_asset_id": video["id"],
                "event_type": "custom",
                "team": "home",
                "start_seconds": 12,
                "end_seconds": 20,
                "player_name": None,
                "outcome": "Manual delete check",
                "notes": None,
                "phase_number": None,
                "field_zone": None,
                "clip_requested": False,
            },
        )

        assert event.status_code == 201
        event_id = event.json()["id"]
        deleted = client.delete(f"/api/timeline-events/{event_id}")

        assert deleted.status_code == 204
        assert client.get(f"/api/timeline-events/{event_id}").status_code == 404
        timeline = client.get(f"/api/timeline-events?match_id={match_id}&video_asset_id={video['id']}").json()
        assert all(item["id"] != event_id for item in timeline)


def test_evidence_items_create_update_delete_and_validate_match_links() -> None:
    unique = uuid4().hex[:8]
    with TestClient(app) as client:
        organisation_id = client.post(
            "/api/organisations", json={"name": f"Evidence Library {unique}"}
        ).json()["id"]
        home_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Home {unique}"},
        ).json()["id"]
        away_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Away {unique}"},
        ).json()["id"]
        match_id = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "match_date": "2026-07-12",
            },
        ).json()["id"]
        second_match_id = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": away_id,
                "away_team_id": home_id,
                "match_date": "2026-07-13",
            },
        ).json()["id"]
        video = client.post(
            f"/api/matches/{match_id}/videos",
            files={"file": ("evidence-source.mp4", b"not a real video", "video/mp4")},
        ).json()
        event = client.post(
            "/api/timeline-events",
            json={
                "match_id": match_id,
                "video_asset_id": video["id"],
                "event_type": "ruck",
                "team": "home",
                "start_seconds": 32,
                "end_seconds": 38,
                "player_name": None,
                "outcome": "Quick ruck",
                "notes": None,
                "phase_number": None,
                "field_zone": "middle third",
                "clip_requested": False,
            },
        ).json()

        created = client.post(
            "/api/evidence-items",
            json={
                "match_id": match_id,
                "video_asset_id": video["id"],
                "timeline_event_id": event["id"],
                "evidence_type": "clip",
                "label": "Fast clean ruck",
                "rugby_element": "ruck",
                "source_uri": "r2://training/rucks/fast-clean-ruck.mp4",
                "timestamp_seconds": 32,
                "confidence_label": "positive",
                "notes": "Good example for future ruck recognition.",
                "approved_for_training": False,
            },
        )
        assert created.status_code == 201
        item_id = created.json()["id"]

        listed = client.get(f"/api/evidence-items?match_id={match_id}").json()
        assert item_id in [item["id"] for item in listed]
        assert any(item["evidence_type"] == "video" and item["source"] == "uploaded_video" for item in listed)
        assert any(item["timeline_event_id"] == event["id"] and item["source"] == "manual_code" for item in listed)

        updated = client.patch(
            f"/api/evidence-items/{item_id}",
            json={"approved_for_training": True, "confidence_label": "verified"},
        )
        assert updated.status_code == 200
        assert updated.json()["approved_for_training"] is True
        assert updated.json()["confidence_label"] == "verified"

        invalid = client.post(
            "/api/evidence-items",
            json={
                "match_id": second_match_id,
                "video_asset_id": video["id"],
                "evidence_type": "clip",
                "label": "Wrong match link",
            },
        )
        assert invalid.status_code == 422

        assert client.delete(f"/api/evidence-items/{item_id}").status_code == 204
        remaining = client.get(f"/api/evidence-items?match_id={match_id}").json()
        assert item_id not in [item["id"] for item in remaining]


def test_manual_event_clip_creates_clip_evidence(monkeypatch) -> None:
    unique = uuid4().hex[:8]

    def fake_generate_event_clip(
        source_path: str,
        event_id: int,
        start_seconds: float,
        end_seconds: float,
    ) -> tuple[str, float]:
        return f"clips/event-{event_id}.mp4", end_seconds - start_seconds

    monkeypatch.setattr("app.api.events.generate_event_clip", fake_generate_event_clip)
    with TestClient(app) as client:
        organisation_id = client.post(
            "/api/organisations", json={"name": f"Clip Evidence {unique}"}
        ).json()["id"]
        home_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Home {unique}"},
        ).json()["id"]
        away_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Away {unique}"},
        ).json()["id"]
        match_id = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "match_date": "2026-07-12",
            },
        ).json()["id"]
        video = client.post(
            f"/api/matches/{match_id}/videos",
            files={"file": ("clip-source.mp4", b"not a real video", "video/mp4")},
        ).json()
        created = client.post(
            "/api/timeline-events",
            json={
                "match_id": match_id,
                "video_asset_id": video["id"],
                "event_type": "carry",
                "team": "home",
                "start_seconds": 12.5,
                "end_seconds": 27.5,
                "outcome": "carry",
                "clip_requested": True,
            },
        )
        evidence = client.get(f"/api/evidence-items?match_id={match_id}").json()

    event = created.json()
    event_evidence = next(item for item in evidence if item["timeline_event_id"] == event["id"])
    assert created.status_code == 201
    assert event["clip"]["duration_seconds"] == 15
    assert event_evidence["evidence_type"] == "clip"
    assert event_evidence["source_uri"] == f"clips/event-{event['id']}.mp4"


def test_delete_stored_evidence_clips_clears_clip_media_without_deleting_events(monkeypatch) -> None:
    unique = uuid4().hex[:8]
    deleted_paths: list[str] = []
    monkeypatch.setattr("app.api.routes._delete_media_reference", deleted_paths.append)
    with TestClient(app) as client:
        organisation_id = client.post(
            "/api/organisations", json={"name": f"Clear Clips {unique}"}
        ).json()["id"]
        home_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Home {unique}"},
        ).json()["id"]
        away_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Away {unique}"},
        ).json()["id"]
        match_id = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "match_date": "2026-07-12",
            },
        ).json()["id"]
        video = client.post(
            f"/api/matches/{match_id}/videos",
            files={"file": ("clear-clips-source.mp4", b"not a real video", "video/mp4")},
        ).json()
        event = client.post(
            "/api/timeline-events",
            json={
                "match_id": match_id,
                "video_asset_id": video["id"],
                "event_type": "carry",
                "team": "home",
                "start_seconds": 15,
                "end_seconds": 30,
                "outcome": "carry",
                "clip_requested": False,
            },
        ).json()
        with SessionLocal() as db:
            db.add(EventClip(event_id=event["id"], file_path="clips/full-duration-bad.mp4", duration_seconds=3600))
            db.commit()
        missing_confirm = client.delete("/api/evidence-items/stored-clips")
        clear = client.delete("/api/evidence-items/stored-clips?confirm=true")
        refreshed_event = client.get(f"/api/timeline-events/{event['id']}").json()
        evidence = client.get(f"/api/evidence-items?match_id={match_id}").json()

    assert missing_confirm.status_code == 422
    assert clear.status_code == 200
    assert clear.json()["clips_deleted"] >= 1
    assert refreshed_event["clip"] is None
    assert "clips/full-duration-bad.mp4" in deleted_paths
    assert any(
        item["timeline_event_id"] == event["id"]
        and item["evidence_type"] == "clip"
        and item["source_uri"] is None
        for item in evidence
    )


def test_delete_match_evidence_removes_items_and_clip_media_without_deleting_events(monkeypatch) -> None:
    unique = uuid4().hex[:8]
    deleted_paths: list[str] = []
    monkeypatch.setattr("app.api.routes._delete_media_reference", deleted_paths.append)
    with TestClient(app) as client:
        organisation_id = client.post(
            "/api/organisations", json={"name": f"Delete Evidence {unique}"}
        ).json()["id"]
        home_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Home {unique}"},
        ).json()["id"]
        away_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Away {unique}"},
        ).json()["id"]
        match_id = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "match_date": "2026-07-12",
            },
        ).json()["id"]
        video = client.post(
            f"/api/matches/{match_id}/videos",
            files={"file": ("delete-evidence-source.mp4", b"not a real video", "video/mp4")},
        ).json()
        event = client.post(
            "/api/timeline-events",
            json={
                "match_id": match_id,
                "video_asset_id": video["id"],
                "event_type": "carry",
                "team": "home",
                "start_seconds": 15,
                "end_seconds": 30,
                "outcome": "carry",
                "clip_requested": False,
            },
        ).json()
        with SessionLocal() as db:
            db.add(EventClip(event_id=event["id"], file_path="clips/evidence-delete.mp4", duration_seconds=15))
            db.commit()

        missing_confirm = client.delete(f"/api/evidence-items?match_id={match_id}")
        deleted = client.delete(f"/api/evidence-items?match_id={match_id}&confirm=true")
        remaining_evidence = client.get(f"/api/evidence-items?match_id={match_id}").json()
        refreshed_event = client.get(f"/api/timeline-events/{event['id']}").json()

    assert missing_confirm.status_code == 422
    assert deleted.status_code == 200
    assert deleted.json()["evidence_items_deleted"] >= 1
    assert deleted.json()["clips_deleted"] == 1
    assert remaining_evidence == []
    assert refreshed_event["id"] == event["id"]
    assert refreshed_event["clip"] is None
    assert deleted_paths == ["clips/evidence-delete.mp4"]


def test_manual_tackle_creates_confirmed_evidence_and_linked_opposition_carry() -> None:
    unique = uuid4().hex[:8]
    with TestClient(app) as client:
        organisation_id = client.post(
            "/api/organisations", json={"name": f"Linked Logic {unique}"}
        ).json()["id"]
        home_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Home {unique}"},
        ).json()["id"]
        away_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Away {unique}"},
        ).json()["id"]
        match_id = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "match_date": "2026-07-12",
            },
        ).json()["id"]
        video = client.post(
            f"/api/matches/{match_id}/videos",
            files={"file": ("linked-source.mp4", b"not a real video", "video/mp4")},
        ).json()
        tackle = client.post(
            "/api/timeline-events",
            json={
                "match_id": match_id,
                "video_asset_id": video["id"],
                "event_type": "tackle",
                "team": "home",
                "start_seconds": 40,
                "end_seconds": 55,
                "outcome": "dominant tackle",
                "field_zone": "middle third",
                "clip_requested": False,
            },
        ).json()
        timeline = client.get(f"/api/timeline-events?match_id={match_id}&video_asset_id={video['id']}").json()
        linked = [event for event in timeline if event.get("linked_event_id") == tackle["id"]]
        evidence = client.get(f"/api/evidence-items?match_id={match_id}").json()

    assert tackle["trust_status"] == "confirmed"
    assert len(linked) == 1
    assert linked[0]["event_type"] == "carry"
    assert linked[0]["team"] == "away"
    assert linked[0]["outcome"] == "negative carry"
    assert linked[0]["trust_status"] == "linked_unconfirmed"
    assert any(item["timeline_event_id"] == tackle["id"] and item["status"] == "confirmed" for item in evidence)
    assert any(item["timeline_event_id"] == linked[0]["id"] and item["status"] == "linked_unconfirmed" for item in evidence)


def test_manual_carry_creates_linked_opposition_tackle() -> None:
    unique = uuid4().hex[:8]
    with TestClient(app) as client:
        organisation_id = client.post(
            "/api/organisations", json={"name": f"Carry Logic {unique}"}
        ).json()["id"]
        home_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Home {unique}"},
        ).json()["id"]
        away_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Away {unique}"},
        ).json()["id"]
        match_id = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "match_date": "2026-07-12",
            },
        ).json()["id"]
        video = client.post(
            f"/api/matches/{match_id}/videos",
            files={
                "file": (
                    "carry-linked-source.mp4",
                    b"not a real video",
                    "video/mp4",
                )
            },
        ).json()
        carry = client.post(
            "/api/timeline-events",
            json={
                "match_id": match_id,
                "video_asset_id": video["id"],
                "event_type": "carry",
                "team": "home",
                "start_seconds": 64,
                "end_seconds": 79,
                "outcome": "carry",
                "field_zone": "middle third",
                "clip_requested": False,
            },
        ).json()
        timeline = client.get(
            f"/api/timeline-events?match_id={match_id}&video_asset_id={video['id']}"
        ).json()
        linked = [event for event in timeline if event.get("linked_event_id") == carry["id"]]
        evidence = client.get(f"/api/evidence-items?match_id={match_id}").json()

    assert carry["trust_status"] == "confirmed"
    assert len(linked) == 1
    assert linked[0]["event_type"] == "tackle"
    assert linked[0]["team"] == "away"
    assert linked[0]["outcome"] == "tackle made"
    assert linked[0]["trust_status"] == "linked_unconfirmed"
    assert any(
        item["timeline_event_id"] == carry["id"] and item["status"] == "confirmed" for item in evidence
    )
    assert any(
        item["timeline_event_id"] == linked[0]["id"] and item["status"] == "linked_unconfirmed"
        for item in evidence
    )


def test_report_metrics_scores_only_true_scoring_outcomes() -> None:
    unique = uuid4().hex[:8]
    with TestClient(app) as client:
        organisation_id = client.post(
            "/api/organisations", json={"name": f"Report Score {unique}"}
        ).json()["id"]
        home_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Home {unique}"},
        ).json()["id"]
        away_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Away {unique}"},
        ).json()["id"]
        match_id = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "match_date": "2026-07-12",
            },
        ).json()["id"]
        video = client.post(
            f"/api/matches/{match_id}/videos",
            files={"file": ("score-source.mp4", b"not a real video", "video/mp4")},
        ).json()
        for payload in [
            {"event_type": "try", "team": "home", "start_seconds": 10, "end_seconds": 25, "outcome": "try"},
            {"event_type": "conversion", "team": "home", "start_seconds": 26, "end_seconds": 41, "outcome": "conversion"},
            {"event_type": "custom", "team": "home", "start_seconds": 42, "end_seconds": 57, "outcome": "Conversion"},
            {"event_type": "penalty", "team": "away", "start_seconds": 50, "end_seconds": 65, "outcome": "touch"},
            {"event_type": "penalty", "team": "away", "start_seconds": 70, "end_seconds": 85, "outcome": "goal"},
        ]:
            response = client.post(
                "/api/timeline-events",
                json={
                    "match_id": match_id,
                    "video_asset_id": video["id"],
                    "clip_requested": False,
                    **payload,
                },
            )
            assert response.status_code == 201
        metrics = client.get(f"/api/reports/matches/{match_id}/metrics?video_asset_id={video['id']}").json()

    assert metrics["home_score"] == 9
    assert metrics["away_score"] == 3
    assert [item["points"] for item in metrics["scoring_flow"]] == [5, 2, 2, 3]


def test_delete_organisation_cascades_workspace_and_catalogue() -> None:
    unique = uuid4().hex[:8]
    with TestClient(app) as client:
        organisation_id = client.post(
            "/api/organisations", json={"name": f"Cascade Delete {unique}"}
        ).json()["id"]
        team_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Team {unique}"},
        ).json()["id"]
        opponent_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Opponent {unique}"},
        ).json()["id"]
        match_id = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": team_id,
                "away_team_id": opponent_id,
                "match_date": "2026-07-12",
            },
        ).json()["id"]
        video = client.post(
            f"/api/matches/{match_id}/videos",
            files={"file": ("cascade-source.mp4", b"not a real video", "video/mp4")},
        ).json()
        event = client.post(
            "/api/timeline-events",
            json={
                "match_id": match_id,
                "video_asset_id": video["id"],
                "event_type": "carry",
                "team": "home",
                "start_seconds": 10,
                "end_seconds": 25,
                "outcome": "carry",
                "clip_requested": False,
            },
        )
        assert event.status_code == 201
        season_id = client.post(
            "/api/catalog/seasons",
            json={"organisation_id": organisation_id, "name": f"Season {unique}", "is_active": True},
        ).json()["id"]
        client.post(
            "/api/catalog/competitions",
            json={"organisation_id": organisation_id, "season_id": season_id, "name": f"Cup {unique}"},
        )
        client.post(
            "/api/catalog/players",
            json={"organisation_id": organisation_id, "team_id": team_id, "first_name": "Delete", "last_name": unique},
        )

        deleted = client.delete(f"/api/organisations/{organisation_id}")
        assert deleted.status_code == 204
        assert client.get(f"/api/catalog/bootstrap?organisation_id={organisation_id}").status_code == 404
        teams = client.get("/api/teams").json()
        assert all(team["organisation_id"] != organisation_id for team in teams)


def test_delete_catalogue_records() -> None:
    unique = uuid4().hex[:8]
    with TestClient(app) as client:
        organisation_id = client.post(
            "/api/organisations", json={"name": f"Catalogue Delete {unique}"}
        ).json()["id"]
        team_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Team {unique}"},
        ).json()["id"]
        season_id = client.post(
            "/api/catalog/seasons",
            json={"organisation_id": organisation_id, "name": f"Season {unique}", "is_active": True},
        ).json()["id"]
        competition_id = client.post(
            "/api/catalog/competitions",
            json={"organisation_id": organisation_id, "season_id": season_id, "name": f"Cup {unique}"},
        ).json()["id"]
        player_id = client.post(
            "/api/catalog/players",
            json={"organisation_id": organisation_id, "team_id": team_id, "first_name": "Player", "last_name": unique},
        ).json()["id"]

        assert client.delete(f"/api/catalog/players/{player_id}").status_code == 204
        assert client.delete(f"/api/catalog/competitions/{competition_id}").status_code == 204
        assert client.delete(f"/api/catalog/seasons/{season_id}").status_code == 204
        catalog = client.get(f"/api/catalog/bootstrap?organisation_id={organisation_id}").json()
        assert catalog == {"seasons": [], "competitions": [], "players": []}


def test_detect_automatic_suggestions_creates_review_items(monkeypatch) -> None:
    unique = uuid4().hex[:8]
    monkeypatch.setattr("app.api.suggestions.detect_scene_changes", lambda *_args, **_kwargs: [5.0, 30.0])
    monkeypatch.setattr("app.api.suggestions.probe_video", lambda *_args, **_kwargs: SimpleNamespace(duration_seconds=60.0))

    with TestClient(app) as client:
        organisation_id = client.post(
            "/api/organisations", json={"name": f"Detection {unique}"}
        ).json()["id"]
        home_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Home {unique}"},
        ).json()["id"]
        away_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Away {unique}"},
        ).json()["id"]
        match_id = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "match_date": "2026-07-12",
            },
        ).json()["id"]
        video = client.post(
            f"/api/matches/{match_id}/videos",
            files={"file": ("sample.mp4", b"not a real video", "video/mp4")},
        ).json()

        response = client.post(
            "/api/automatic-suggestions/detect",
            json={"video_asset_id": video["id"], "replace_pending": True, "scene_threshold": 0.3},
        )

    assert response.status_code == 201
    suggestions = response.json()
    assert len(suggestions) == 3
    assert suggestions[0]["event_type"] == "kickoff"
    assert {item["video_asset_id"] for item in suggestions} == {video["id"]}


def test_detect_automatic_suggestions_timeout_creates_opening_item(monkeypatch) -> None:
    unique = uuid4().hex[:8]

    def raise_timeout(*_args, **_kwargs) -> list[float]:
        raise TimeoutError

    monkeypatch.setattr("app.api.suggestions.detect_scene_changes", raise_timeout)
    monkeypatch.setattr("app.api.suggestions.probe_video", lambda *_args, **_kwargs: SimpleNamespace(duration_seconds=60.0))

    with TestClient(app) as client:
        organisation_id = client.post(
            "/api/organisations", json={"name": f"Detection Timeout {unique}"}
        ).json()["id"]
        home_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Home {unique}"},
        ).json()["id"]
        away_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Away {unique}"},
        ).json()["id"]
        match_id = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "match_date": "2026-07-12",
            },
        ).json()["id"]
        video = client.post(
            f"/api/matches/{match_id}/videos",
            files={"file": ("sample-timeout.mp4", b"not a real video", "video/mp4")},
        ).json()

        response = client.post(
            "/api/automatic-suggestions/detect",
            json={"video_asset_id": video["id"], "replace_pending": True, "scene_threshold": 0.3},
        )

    assert response.status_code == 201
    suggestions = response.json()
    assert len(suggestions) == 1
    assert suggestions[0]["event_type"] == "kickoff"


def test_detection_job_completes_and_creates_suggestions(monkeypatch) -> None:
    unique = uuid4().hex[:8]
    monkeypatch.setattr("app.api.suggestions.detect_scene_changes", lambda *_args, **_kwargs: [8.0])
    monkeypatch.setattr("app.api.suggestions.probe_video", lambda *_args, **_kwargs: SimpleNamespace(duration_seconds=45.0))

    with TestClient(app) as client:
        organisation_id = client.post(
            "/api/organisations", json={"name": f"Detection Job {unique}"}
        ).json()["id"]
        home_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Home {unique}"},
        ).json()["id"]
        away_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Away {unique}"},
        ).json()["id"]
        match_id = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "match_date": "2026-07-12",
            },
        ).json()["id"]
        video = client.post(
            f"/api/matches/{match_id}/videos",
            files={"file": ("sample-job.mp4", b"not a real video", "video/mp4")},
        ).json()

        created = client.post(
            "/api/automatic-suggestions/detect-jobs",
            json={"video_asset_id": video["id"], "replace_pending": True, "scene_threshold": 0.3},
        )
        assert created.status_code == 202
        job = client.get(f"/api/analysis-jobs/{created.json()['id']}").json()
        suggestions = client.get(f"/api/automatic-suggestions?video_asset_id={video['id']}").json()

    assert job["status"] == "completed"
    assert job["progress_percent"] == 100
    assert len(suggestions) == 2


def test_accept_suggestion_uses_video_storage_reference_for_clip(monkeypatch) -> None:
    unique = uuid4().hex[:8]
    monkeypatch.setattr("app.api.suggestions.detect_scene_changes", lambda *_args, **_kwargs: [])
    monkeypatch.setattr("app.api.suggestions.probe_video", lambda *_args, **_kwargs: SimpleNamespace(duration_seconds=60.0))
    captured_sources: list[str] = []

    def fake_generate_event_clip(source_path: str, event_id: int, start_seconds: float, end_seconds: float) -> tuple[str, float]:
        captured_sources.append(source_path)
        return f"clips/event-{event_id}.mp4", end_seconds - start_seconds

    monkeypatch.setattr("app.api.suggestions.generate_event_clip", fake_generate_event_clip)
    with TestClient(app) as client:
        organisation_id = client.post(
            "/api/organisations", json={"name": f"Accept Suggestion {unique}"}
        ).json()["id"]
        home_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Home {unique}"},
        ).json()["id"]
        away_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Away {unique}"},
        ).json()["id"]
        match_id = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "match_date": "2026-07-12",
            },
        ).json()["id"]
        video = client.post(
            f"/api/matches/{match_id}/videos",
            files={"file": ("sample-accept.mp4", b"not a real video", "video/mp4")},
        ).json()
        created = client.post(
            "/api/automatic-suggestions/detect",
            json={"video_asset_id": video["id"], "replace_pending": True, "scene_threshold": 0.3},
        )
        suggestion_id = created.json()[0]["id"]

        r2_uri = f"r2://rugby-video-analysis/source-videos/{video['id']}/sample-accept.mp4"
        with SessionLocal() as db:
            asset = db.get(VideoAsset, video["id"])
            assert asset is not None
            asset.storage_path = r2_uri
            db.commit()

        monkeypatch.setattr(
            "app.api.suggestions._materialized_video_path",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("Accept should not materialize the R2 source")),
        )
        accepted = client.post(f"/api/automatic-suggestions/{suggestion_id}/accept")

    assert accepted.status_code == 200
    assert accepted.json()["status"] == "accepted"
    assert captured_sources == [r2_uri]


def test_multipart_upload_session_is_reused_and_records_parts(monkeypatch) -> None:
    unique = uuid4().hex[:8]
    upload_ids: list[str] = []

    monkeypatch.setattr("app.api.multipart_uploads.is_object_storage_enabled", lambda: True)

    def fake_create_multipart_upload(object_key: str, content_type: str | None = None) -> str:
        upload_id = f"upload-{unique}-{len(upload_ids) + 1}"
        upload_ids.append(upload_id)
        return upload_id

    monkeypatch.setattr("app.api.multipart_uploads.create_multipart_upload", fake_create_multipart_upload)
    monkeypatch.setattr("app.api.multipart_uploads.create_presigned_part_url", lambda *_: "https://example.test/part")

    with TestClient(app) as client:
        organisation_id = client.post(
            "/api/organisations", json={"name": f"Multipart Resume {unique}"}
        ).json()["id"]
        home_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Home {unique}"},
        ).json()["id"]
        away_id = client.post(
            "/api/teams",
            json={"organisation_id": organisation_id, "name": f"Away {unique}"},
        ).json()["id"]
        match_id = client.post(
            "/api/matches",
            json={
                "organisation_id": organisation_id,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "match_date": "2026-07-12",
            },
        ).json()["id"]
        payload = {
            "match_id": match_id,
            "filename": "full-match.mp4",
            "content_type": "video/mp4",
            "size_bytes": 4_800_000_000,
        }

        created = client.post("/api/multipart-uploads", json=payload)
        assert created.status_code == 201
        session = created.json()
        assert session["resumed"] is False
        assert session["uploaded_parts"] == []
        assert session["total_parts"] == 287

        recorded = client.post(
            "/api/multipart-uploads/parts",
            json={
                "object_key": session["object_key"],
                "upload_id": session["upload_id"],
                "part": {"part_number": 1, "etag": '"etag-1"'},
            },
        )
        assert recorded.status_code == 200
        assert recorded.json()["uploaded_parts"] == [{"part_number": 1, "etag": '"etag-1"'}]

        resumed = client.post("/api/multipart-uploads", json=payload)
        assert resumed.status_code == 201
        assert resumed.json()["resumed"] is True
        assert resumed.json()["upload_id"] == session["upload_id"]
        assert resumed.json()["object_key"] == session["object_key"]
        assert resumed.json()["uploaded_parts"] == [{"part_number": 1, "etag": '"etag-1"'}]
        assert upload_ids == [f"upload-{unique}-1"]
