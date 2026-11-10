"""Phase 8: trash, tags, content search and version rollback."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import main as main_module
from app.db.base import utcnow
from app.models.project import Project

NODES = [
    {
        "id": "n1",
        "parentId": None,
        "label": "Tổng quan",
        "time": 0.0,
        "note": "Đạo hàm riêng",
        "pinned": False,
        "children": [],
    }
]
CUES = [
    {"start": 0.0, "duration": 4.0, "text": "hello world"},
    {"start": 4.0, "duration": 4.0, "text": "second cue"},
]


def register(client: TestClient, email: str = "kivic@example.com") -> dict[str, str]:
    body = client.post(
        "/api/auth/register",
        json={"email": email, "password": "hunter2pass", "display_name": "Kivic"},
    ).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def create_project(client: TestClient, headers: dict[str, str], **overrides) -> dict:
    payload = {
        "title": "Giải tích",
        "video_id": "abcdefghijk",
        "nodes": NODES,
        "transcript": CUES,
        "transcript_language": "vi",
        "consumed_until": 8.0,
    }
    payload.update(overrides)
    response = client.post("/api/projects", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_delete_moves_to_trash_and_restore_brings_it_back(client: TestClient):
    headers = register(client)
    project = create_project(client, headers)

    assert client.delete(f"/api/projects/{project['id']}", headers=headers).status_code == 204

    assert client.get(f"/api/projects/{project['id']}", headers=headers).status_code == 404
    assert client.get("/api/projects", headers=headers).json()["total"] == 0

    trash = client.get("/api/projects/trash", headers=headers).json()
    assert trash["total"] == 1
    assert trash["items"][0]["id"] == project["id"]
    assert trash["items"][0]["days_left"] == 30

    stats = client.get("/api/projects/stats", headers=headers).json()
    assert stats["trashed"] == 1
    assert stats["saved"] == 0

    restored = client.post(
        f"/api/projects/{project['id']}/restore", headers=headers
    )
    assert restored.status_code == 200
    assert restored.json()["title"] == project["title"]
    assert client.get("/api/projects/trash", headers=headers).json()["total"] == 0
    assert client.get(f"/api/projects/{project['id']}", headers=headers).status_code == 200


def test_trash_purge_is_permanent_and_only_for_trashed_rows(client: TestClient):
    headers = register(client)
    project = create_project(client, headers)

    # An active project cannot be purged by guessing its id.
    assert (
        client.delete(f"/api/projects/{project['id']}/purge", headers=headers).status_code
        == 409
    )

    client.delete(f"/api/projects/{project['id']}", headers=headers)
    assert (
        client.delete(f"/api/projects/{project['id']}/purge", headers=headers).status_code
        == 204
    )
    assert client.get("/api/projects/trash", headers=headers).json()["total"] == 0
    assert client.get(f"/api/projects/{project['id']}", headers=headers).status_code == 404


def test_trashed_project_stops_being_shared(client: TestClient):
    headers = register(client)
    project = create_project(client, headers)
    client.put(
        f"/api/projects/{project['id']}/share",
        json={"enabled": True, "access": "anyone", "role": "viewer"},
        headers=headers,
    )
    slug = client.get(f"/api/projects/{project['id']}/share", headers=headers).json()["slug"]

    client.delete(f"/api/projects/{project['id']}", headers=headers)
    assert client.get(f"/api/share/{slug}").status_code == 404


def test_expired_trash_is_purged_on_read(client: TestClient, db_session: Session):
    headers = register(client)
    project = create_project(client, headers)
    client.delete(f"/api/projects/{project['id']}", headers=headers)

    row = db_session.get(Project, project["id"])
    assert row is not None
    row.deleted_at = utcnow() - timedelta(days=31)
    db_session.commit()

    assert client.get("/api/projects/trash", headers=headers).json()["total"] == 0
    db_session.expire_all()
    assert db_session.get(Project, project["id"]) is None


def test_tags_are_normalized_and_filter_projects(client: TestClient):
    headers = register(client)
    project = create_project(
        client, headers, title="Toán rời rạc", tags=[" Toán ", "toán", "AI"]
    )
    assert project["tags"] == ["toan", "ai"]

    create_project(
        client, headers, title="Lịch sử", video_id="zzzzzzzzzzz", tags=["Ôn thi"]
    )

    tags = client.get("/api/projects/tags", headers=headers).json()["items"]
    assert {item["tag"]: item["count"] for item in tags} == {
        "ai": 1,
        "on thi": 1,
        "toan": 1,
    }

    filtered = client.get(
        "/api/projects", params={"tag": "toan"}, headers=headers
    ).json()
    assert [item["title"] for item in filtered["items"]] == ["Toán rời rạc"]

    updated = client.patch(
        f"/api/projects/{project['id']}",
        json={"tags": ["Đại số", "đại số", ""]},
        headers=headers,
    ).json()
    assert updated["tags"] == ["dai so"]


def test_search_reads_nodes_notes_transcript_and_summary(client: TestClient):
    headers = register(client)
    project = create_project(client, headers, summary_so_far="Chuỗi và giới hạn")

    # Accents are optional, and notes/transcript are searchable, not just titles.
    note = client.get(
        "/api/projects/search", params={"q": "dao ham"}, headers=headers
    ).json()["items"]
    assert [item["id"] for item in note] == [project["id"]]
    assert note[0]["matches"][0]["kind"] == "note"

    transcript = client.get(
        "/api/projects/search", params={"q": "hello"}, headers=headers
    ).json()["items"]
    assert transcript[0]["matches"][0]["kind"] == "transcript"
    assert transcript[0]["matches"][0]["time"] == 0.0

    summary = client.get(
        "/api/projects/search", params={"q": "gioi han"}, headers=headers
    ).json()["items"]
    assert summary[0]["matches"][0]["kind"] == "summary"

    client.delete(f"/api/projects/{project['id']}", headers=headers)
    assert (
        client.get("/api/projects/search", params={"q": "hello"}, headers=headers)
        .json()["items"]
        == []
    )


def test_search_backfills_rows_saved_before_phase_8(
    client: TestClient, db_session: Session
):
    headers = register(client)
    project = create_project(client, headers)

    row = db_session.get(Project, project["id"])
    assert row is not None
    row.search_text = ""
    db_session.commit()

    found = client.get(
        "/api/projects/search", params={"q": "dao ham"}, headers=headers
    ).json()["items"]
    assert [item["id"] for item in found] == [project["id"]]
    db_session.expire_all()
    assert db_session.get(Project, project["id"]).search_text


def test_search_rejects_short_queries(client: TestClient):
    headers = register(client)
    assert client.get("/api/projects/search", params={"q": "a"}, headers=headers).status_code == 422


@pytest.fixture()
def session_with_nodes(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> dict:
    monkeypatch.setattr(
        main_module, "fetch_transcript", lambda _url: (list(CUES), "vi")
    )

    async def fake_title(_url: str) -> str:
        return "Bài giảng thử"

    monkeypatch.setattr(main_module, "_fetch_youtube_title", fake_title)
    body = client.post(
        "/transcript",
        json={"url": "https://youtu.be/abcdefghijk", "initial_nodes": NODES},
    ).json()
    assert body["session_id"]
    return body


def test_versions_capture_the_map_before_a_write_and_restore(
    client: TestClient, session_with_nodes: dict
):
    headers = register(client)
    session_id = session_with_nodes["session_id"]

    first = client.post(
        "/api/projects/autosave", json={"session_id": session_id}, headers=headers
    )
    assert first.status_code == 200, first.text
    project_id = first.json()["id"]

    # Change the live map, then autosave: the pre-write state becomes a version.
    edited = client.patch(
        "/node",
        json={"session_id": session_id, "node_id": "n1", "label": "Tổng quan v2"},
        headers=headers,
    )
    assert edited.status_code == 200, edited.text
    client.post(
        "/api/projects/autosave", json={"session_id": session_id}, headers=headers
    )

    versions = client.get(
        f"/api/projects/{project_id}/versions", headers=headers
    ).json()["items"]
    assert len(versions) == 1
    assert versions[0]["node_count"] == 1

    detail = client.get(
        f"/api/projects/{project_id}/versions/{versions[0]['id']}", headers=headers
    ).json()
    assert detail["nodes"][0]["label"] == "Tổng quan"

    restored = client.post(
        f"/api/projects/{project_id}/versions/{versions[0]['id']}/restore",
        headers=headers,
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["nodes"][0]["label"] == "Tổng quan"

    # The live session is updated too, otherwise the next autosave would undo it.
    assert main_module.sessions[session_id]["nodes"][0]["label"] == "Tổng quan"

    # Restoring keeps the replaced state, so the rollback itself can be undone.
    after = client.get(
        f"/api/projects/{project_id}/versions", headers=headers
    ).json()["items"]
    assert len(after) == 2


def test_version_routes_are_private(client: TestClient, session_with_nodes: dict):
    headers = register(client)
    client.post(
        "/api/projects/autosave",
        json={"session_id": session_with_nodes["session_id"]},
        headers=headers,
    )
    project_id = client.get("/api/projects", headers=headers).json()["items"][0]["id"]

    stranger = register(client, email="other@example.com")
    assert (
        client.get(f"/api/projects/{project_id}/versions", headers=stranger).status_code
        == 404
    )
