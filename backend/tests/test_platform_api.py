from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


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
