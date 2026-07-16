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


def test_multipart_upload_session_is_reused_and_records_parts(monkeypatch) -> None:
    unique = uuid4().hex[:8]
    upload_ids: list[str] = []

    monkeypatch.setattr("app.api.multipart_uploads.is_object_storage_enabled", lambda: True)

    def fake_create_multipart_upload(object_key: str, content_type: str | None = None) -> str:
        upload_id = f"upload-{len(upload_ids) + 1}"
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
        assert upload_ids == ["upload-1"]
