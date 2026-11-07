"""Saved projects: CRUD, ownership, autosave and resume."""

import pytest
from fastapi.testclient import TestClient

import main as main_module

NODES = [
    {
        "id": "n1",
        "parentId": None,
        "label": "Root",
        "time": 0.0,
        "note": "my note",
        "pinned": True,
    }
]
CUES = [
    {"start": 0.0, "duration": 4.0, "text": "hello"},
    {"start": 4.0, "duration": 4.0, "text": "world"},
]


def register(client: TestClient, email: str = "kivic@example.com") -> dict[str, str]:
    body = client.post(
        "/api/auth/register",
        json={"email": email, "password": "hunter2pass", "display_name": "Kivic"},
    ).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def create_project(client: TestClient, headers: dict[str, str], **overrides) -> dict:
    payload = {
        "title": "Python cơ bản",
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


def test_node_count_includes_nested_branches(client: TestClient):
    """The tree is nested, so len(nodes) would only count the roots."""

    headers = register(client)
    created = create_project(
        client,
        headers,
        nodes=[
            {
                "id": "root",
                "parentId": None,
                "label": "Root",
                "time": 0.0,
                "children": [
                    {
                        "id": "child",
                        "parentId": "root",
                        "label": "Child",
                        "time": 4.0,
                        "children": [
                            {
                                "id": "grandchild",
                                "parentId": "child",
                                "label": "Grandchild",
                                "time": 8.0,
                                "children": [],
                            }
                        ],
                    }
                ],
            }
        ],
    )

    assert created["node_count"] == 3
    assert client.get("/api/projects", headers=headers).json()["items"][0]["node_count"] == 3


def test_project_crud_lifecycle(client: TestClient):
    headers = register(client)
    created = create_project(client, headers)

    assert created["node_count"] == 1
    assert created["nodes"][0]["note"] == "my note"
    assert created["is_draft"] is False
    assert created["visibility"] == "private"
    assert created["share_slug"] is None

    listing = client.get("/api/projects", headers=headers).json()
    assert listing["total"] == 1
    assert listing["items"][0]["title"] == "Python cơ bản"
    # The list never ships the transcript.
    assert "transcript" not in listing["items"][0]

    renamed = client.patch(
        f"/api/projects/{created['id']}",
        json={"title": "Đã đổi tên"},
        headers=headers,
    ).json()
    assert renamed["title"] == "Đã đổi tên"

    copy = client.post(
        f"/api/projects/{created['id']}/duplicate", headers=headers
    )
    assert copy.status_code == 201
    assert copy.json()["title"] == "Đã đổi tên (bản sao)"
    assert copy.json()["id"] != created["id"]

    assert client.delete(f"/api/projects/{created['id']}", headers=headers).status_code == 204
    assert client.get(f"/api/projects/{created['id']}", headers=headers).status_code == 404


def test_projects_are_private_to_their_owner(client: TestClient):
    owner = register(client)
    stranger = register(client, email="other@example.com")
    project = create_project(client, owner)

    assert client.get(f"/api/projects/{project['id']}", headers=stranger).status_code == 404
    assert (
        client.patch(
            f"/api/projects/{project['id']}", json={"title": "x"}, headers=stranger
        ).status_code
        == 404
    )
    assert (
        client.delete(f"/api/projects/{project['id']}", headers=stranger).status_code
        == 404
    )
    assert client.get("/api/projects", headers=stranger).json()["total"] == 0


def test_create_requires_a_session(client: TestClient):
    response = client.post("/api/projects", json={"title": "x"})
    assert response.status_code == 401


def test_drafts_and_saved_projects_are_listed_separately(client: TestClient):
    headers = register(client)
    create_project(client, headers, title="Dự án", is_draft=False)
    create_project(client, headers, title="Bản nháp", is_draft=True, video_id="zzzzzzzzzzz")

    drafts = client.get("/api/projects", params={"draft": "true"}, headers=headers).json()
    saved = client.get("/api/projects", params={"draft": "false"}, headers=headers).json()
    assert drafts["total"] == 1
    assert drafts["items"][0]["title"] == "Bản nháp"
    assert saved["total"] == 1
    assert saved["items"][0]["title"] == "Dự án"

    stats = client.get("/api/projects/stats", headers=headers).json()
    assert stats["saved"] == 1
    assert stats["drafts"] == 1
    assert stats["shared"] == 0
    assert len(stats["recent"]) == 1


def test_search_matches_title_and_video_id(client: TestClient):
    headers = register(client)
    create_project(client, headers, title="Giải tích", video_id="aaaaaaaaaaa")
    create_project(client, headers, title="Lập trình", video_id="bbbbbbbbbbb")

    by_title = client.get("/api/projects", params={"q": "giải"}, headers=headers).json()
    by_video = client.get("/api/projects", params={"q": "bbbb"}, headers=headers).json()
    assert [item["title"] for item in by_title["items"]] == ["Giải tích"]
    assert [item["title"] for item in by_video["items"]] == ["Lập trình"]


@pytest.fixture()
def transcript_session(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> dict:
    monkeypatch.setattr(
        main_module, "fetch_transcript", lambda _url: (list(CUES), "vi")
    )
    title = "Bài giảng thử"

    async def fake_title(_url: str) -> str:
        return title

    monkeypatch.setattr(main_module, "_fetch_youtube_title", fake_title)
    body = client.post(
        "/transcript", json={"url": "https://youtu.be/abcdefghijk"}
    ).json()
    assert body["session_id"]
    return body


def test_autosave_creates_one_reusable_draft(
    client: TestClient, transcript_session: dict
):
    headers = register(client)
    session_id = transcript_session["session_id"]

    first = client.post(
        "/api/projects/autosave",
        json={"session_id": session_id},
        headers=headers,
    )
    assert first.status_code == 200, first.text
    draft = first.json()
    assert draft["is_draft"] is True
    assert draft["video_id"] == "abcdefghijk"
    assert draft["title"] == "Bài giảng thử"

    # Saving again (after a reload would be a new session) reuses that draft.
    second = client.post(
        "/api/projects/autosave",
        json={"session_id": session_id},
        headers=headers,
    ).json()
    assert second["id"] == draft["id"]

    listing = client.get("/api/projects", params={"draft": "true"}, headers=headers).json()
    assert listing["total"] == 1

    # Owners never write notes into the shared, cross-account video cache.
    assert main_module.video_cache == {}

    promoted = client.patch(
        f"/api/projects/{draft['id']}",
        json={"title": "Đã lưu", "is_draft": False},
        headers=headers,
    ).json()
    assert promoted["is_draft"] is False
    assert promoted["title"] == "Đã lưu"

    # A later autosave must not demote a saved project back to a draft.
    again = client.post(
        "/api/projects/autosave",
        json={"session_id": session_id, "project_id": draft["id"], "is_draft": True},
        headers=headers,
    ).json()
    assert again["is_draft"] is False
    assert again["title"] == "Đã lưu"


def test_autosave_rejects_another_users_session(
    client: TestClient, transcript_session: dict
):
    owner = register(client)
    stranger = register(client, email="other@example.com")
    first = client.post(
        "/api/projects/autosave",
        json={"session_id": transcript_session["session_id"]},
        headers=owner,
    )
    assert first.status_code == 200

    response = client.post(
        "/api/projects/autosave",
        json={"session_id": transcript_session["session_id"]},
        headers=stranger,
    )
    assert response.status_code == 403


def test_autosave_without_a_session_returns_a_code(client: TestClient):
    headers = register(client)
    response = client.post(
        "/api/projects/autosave",
        json={"session_id": "gone"},
        headers=headers,
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "session_lost"


def test_reopening_a_project_restores_nodes_without_youtube(client: TestClient):
    headers = register(client)
    project = create_project(client, headers)

    # Any caption fetch would now fail the test: the row must be enough.
    def fail(_url):
        raise AssertionError("saved project should not hit YouTube")

    import main as module

    original = module.fetch_transcript
    module.fetch_transcript = fail
    try:
        response = client.post(
            "/transcript", json={"project_id": project["id"]}, headers=headers
        )
    finally:
        module.fetch_transcript = original

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["transcript"]) == 2
    assert body["language"] == "vi"
    assert body["title"] == project["title"]
    assert body["consumed_until"] == 8.0
    assert len(body["nodes"]) == 1
    node = body["nodes"][0]
    assert node["id"] == "n1"
    assert node["label"] == "Root"
    # Notes and pins travel with the project, so they are private per user.
    assert node["note"] == "my note"
    assert node["pinned"] is True


def test_reopening_a_project_requires_the_owner(client: TestClient):
    owner = register(client)
    project = create_project(client, owner)

    assert (
        client.post("/transcript", json={"project_id": project["id"]}).status_code == 401
    )

    stranger = register(client, email="other@example.com")
    response = client.post(
        "/transcript", json={"project_id": project["id"]}, headers=stranger
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "project_not_found"
