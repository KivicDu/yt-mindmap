"""Sharing: link roles, invite-only access, rotation and collaborator writes."""

from fastapi.testclient import TestClient

NODES = [
    {
        "id": "n1",
        "parentId": None,
        "label": "Root",
        "time": 0.0,
        "note": "owner note",
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


def share(
    client: TestClient,
    headers: dict[str, str],
    project_id: str,
    *,
    enabled: bool = True,
    access: str = "anyone",
    role: str = "viewer",
) -> dict:
    response = client.put(
        f"/api/projects/{project_id}/share",
        json={"enabled": enabled, "access": access, "role": role},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


def invite(
    client: TestClient,
    headers: dict[str, str],
    project_id: str,
    email: str,
    role: str = "viewer",
) -> dict:
    response = client.post(
        f"/api/projects/{project_id}/members",
        json={"email": email, "role": role},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_public_link_is_read_only_for_anonymous(client: TestClient):
    owner = register(client)
    project = create_project(client, owner)
    settings = share(client, owner, project["id"], role="viewer")

    assert settings["enabled"] is True
    assert settings["access"] == "anyone"
    assert settings["slug"].startswith("YTMM-")

    response = client.get(f"/api/share/{settings['slug']}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["role"] == "viewer"
    assert body["can_edit"] is False
    assert body["requires_login"] is False
    assert body["project"]["nodes"][0]["note"] == "owner note"
    assert setting_slug(client, owner, project["id"]) == settings["slug"]


def test_share_metadata_is_escaped_and_uses_public_project_data(client: TestClient):
    owner = register(client)
    project = create_project(
        client,
        owner,
        title='Bio <script>alert("x")</script>',
    )
    settings = share(client, owner, project["id"])

    response = client.get("/api/share/meta", params={"slug": settings["slug"]})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "<script>" not in response.text
    assert "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;" in response.text
    assert f"/s/{settings['slug']}" in response.text
    assert "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" in response.text
    assert 'name="robots" content="noindex,nofollow"' in response.text


def test_share_metadata_does_not_reveal_invited_project_title(client: TestClient):
    owner = register(client)
    project = create_project(client, owner, title="Private course title")
    settings = share(client, owner, project["id"], access="invited")

    response = client.get("/api/share/meta", params={"slug": settings["slug"]})

    assert response.status_code == 200
    assert "Private course title" not in response.text
    assert "Sơ đồ tư duy được chia sẻ | yt-mindmap" in response.text


def setting_slug(client: TestClient, headers: dict[str, str], project_id: str) -> str:
    return client.get(f"/api/projects/{project_id}/share", headers=headers).json()["slug"]


def test_anonymous_editor_link_still_cannot_write(client: TestClient):
    owner = register(client)
    project = create_project(client, owner)
    settings = share(client, owner, project["id"], access="anyone", role="editor")

    # Start the live session so the public endpoint can point at it.
    client.post("/transcript", json={"project_id": project["id"]}, headers=owner)

    opened = client.get(f"/api/share/{settings['slug']}").json()
    assert opened["role"] == "editor"
    assert opened["can_edit"] is False
    assert opened["session_id"]

    # A link capability is read-only until someone signs in.
    blocked = client.patch(
        "/node",
        json={"session_id": opened["session_id"], "node_id": "n1", "note": "anon"},
    )
    assert blocked.status_code == 401
    assert blocked.json()["detail"]["code"] == "not_authenticated"


def test_unlisted_link_grants_its_role_to_any_signed_in_user(client: TestClient):
    owner = register(client)
    viewer = register(client, email="viewer@example.com")
    project = create_project(client, owner)
    settings = share(client, owner, project["id"], access="anyone", role="viewer")

    # Signed-in non-members still get the public link role, never editing.
    body = client.get(f"/api/share/{settings['slug']}", headers=viewer).json()
    assert body["role"] == "viewer"
    assert body["can_edit"] is False

    # The same link with an editor role lets a signed-in user change the map.
    share(client, owner, project["id"], access="anyone", role="editor")
    body = client.get(f"/api/share/{settings['slug']}", headers=viewer).json()
    assert body["role"] == "editor"
    assert body["can_edit"] is True

    opened = client.post(
        "/transcript", json={"project_id": project["id"]}, headers=viewer
    )
    assert opened.status_code == 200, opened.text
    opened_body = opened.json()
    assert opened_body["role"] == "editor"
    assert opened_body["can_edit"] is True

    edited = client.patch(
        "/node",
        json={"session_id": opened_body["session_id"], "node_id": "n1", "note": "sửa"},
        headers=viewer,
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["nodes"][0]["note"] == "sửa"


def test_every_editor_shares_one_live_session(client: TestClient):
    owner = register(client)
    editor = register(client, email="editor@example.com")
    project = create_project(client, owner)
    share(client, owner, project["id"], role="editor")

    owner_open = client.post(
        "/transcript", json={"project_id": project["id"]}, headers=owner
    ).json()
    editor_open = client.post(
        "/transcript", json={"project_id": project["id"]}, headers=editor
    ).json()

    # Realtime collaboration reuses one session; otherwise SSE events would
    # only reach the tab that created it.
    assert owner_open["session_id"] == editor_open["session_id"]
    assert editor_open["role"] == "editor"


def test_viewer_cannot_edit_a_shared_session(client: TestClient):
    owner = register(client)
    viewer = register(client, email="viewer@example.com")
    project = create_project(client, owner)
    share(client, owner, project["id"], role="viewer")

    opened = client.post(
        "/transcript", json={"project_id": project["id"]}, headers=viewer
    )
    assert opened.status_code == 200
    session_id = opened.json()["session_id"]
    assert opened.json()["can_edit"] is False

    blocked = client.patch(
        "/node",
        json={"session_id": session_id, "node_id": "n1", "note": "hack"},
        headers=viewer,
    )
    assert blocked.status_code == 403
    assert blocked.json()["detail"]["code"] == "project_read_only"


def test_editor_autosave_writes_map_but_not_the_title(client: TestClient):
    owner = register(client)
    editor = register(client, email="editor@example.com")
    project = create_project(client, owner)
    share(client, owner, project["id"], role="editor")

    opened = client.post(
        "/transcript", json={"project_id": project["id"]}, headers=editor
    ).json()
    session_id = opened["session_id"]

    client.patch(
        "/node",
        json={"session_id": session_id, "node_id": "n1", "note": "cộng tác"},
        headers=editor,
    )
    saved = client.post(
        "/api/projects/autosave",
        json={"session_id": session_id, "project_id": project["id"], "title": "Đổi tên"},
        headers=editor,
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["title"] == "Python cơ bản"

    stored = client.get(f"/api/projects/{project['id']}", headers=owner).json()
    assert stored["title"] == "Python cơ bản"
    assert stored["nodes"][0]["note"] == "cộng tác"

    # Only the owner may delete the project.
    assert client.delete(f"/api/projects/{project['id']}", headers=editor).status_code == 404


def test_viewer_autosave_is_rejected(client: TestClient):
    owner = register(client)
    viewer = register(client, email="viewer@example.com")
    project = create_project(client, owner)
    share(client, owner, project["id"], role="viewer")

    opened = client.post(
        "/transcript", json={"project_id": project["id"]}, headers=viewer
    ).json()
    response = client.post(
        "/api/projects/autosave",
        json={"session_id": opened["session_id"], "project_id": project["id"]},
        headers=viewer,
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "project_read_only"


def test_invite_only_link_checks_the_signed_in_email(client: TestClient):
    owner = register(client)
    invitee = register(client, email="invitee@example.com")
    stranger = register(client, email="stranger@example.com")
    project = create_project(client, owner)
    member = invite(client, owner, project["id"], "invitee@example.com", "editor")
    assert member["registered"] is True
    settings = share(client, owner, project["id"], access="invited", role="viewer")
    slug = settings["slug"]

    anonymous = client.get(f"/api/share/{slug}")
    assert anonymous.status_code == 401
    assert anonymous.json()["detail"]["code"] == "share_login_required"

    denied = client.get(f"/api/share/{slug}", headers=stranger)
    assert denied.status_code == 403
    assert denied.json()["detail"]["code"] == "share_not_invited"

    allowed = client.get(f"/api/share/{slug}", headers=invitee)
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["role"] == "editor"
    assert allowed.json()["can_edit"] is True


def test_invite_before_registration_works(client: TestClient):
    owner = register(client)
    project = create_project(client, owner)
    member = invite(client, owner, project["id"], "future@example.com", "editor")
    assert member["registered"] is False
    share(client, owner, project["id"], access="invited", role="viewer")

    # The invitation is keyed by email, so signing up later activates it.
    future = register(client, email="future@example.com")
    shared = client.get("/api/projects/shared", headers=future).json()
    assert shared["total"] == 1
    assert shared["items"][0]["title"] == "Python cơ bản"
    assert shared["items"][0]["role"] == "editor"
    assert shared["items"][0]["owner_name"] == "Kivic"

    stats = client.get("/api/projects/stats", headers=future).json()
    assert stats["shared_with_me"] == 1


def test_shared_list_supports_sort_and_pagination(client: TestClient, db_session):
    from datetime import timedelta

    from app.db.base import utcnow
    from app.models.project import Project

    owner = register(client)
    invitee = register(client, email="invitee@example.com")

    projects = []
    for title in ("Zeta", "Alpha", "Mika"):
        project = create_project(client, owner, title=title)
        invite(client, owner, project["id"], "invitee@example.com", "viewer")
        share(client, owner, project["id"], access="invited", role="viewer")
        projects.append(project)

    base = utcnow()
    for position, project in enumerate(projects):
        row = db_session.get(Project, project["id"])
        row.created_at = base + timedelta(days=position)
        row.updated_at = base + timedelta(days=2 - position)
    db_session.commit()

    def titles(params: dict) -> list[str]:
        body = client.get(
            "/api/projects/shared", params=params, headers=invitee
        ).json()
        return [item["title"] for item in body["items"]]

    assert titles({"sort": "title"}) == ["Alpha", "Mika", "Zeta"]
    assert titles({"sort": "created"}) == ["Mika", "Alpha", "Zeta"]
    assert titles({"sort": "updated"}) == ["Zeta", "Alpha", "Mika"]

    page = client.get(
        "/api/projects/shared",
        params={"sort": "title", "limit": 2, "offset": 2},
        headers=invitee,
    ).json()
    assert page["total"] == 3
    assert [item["title"] for item in page["items"]] == ["Zeta"]



def test_remove_member_immediately_revokes_access(client: TestClient):
    owner = register(client)
    invitee = register(client, email="invitee@example.com")
    project = create_project(client, owner)
    member = invite(client, owner, project["id"], "invitee@example.com", "viewer")
    settings = share(client, owner, project["id"], access="invited")
    slug = settings["slug"]

    assert client.get(f"/api/share/{slug}", headers=invitee).status_code == 200

    removed = client.delete(
        f"/api/projects/{project['id']}/members/{member['id']}", headers=owner
    )
    assert removed.status_code == 204
    assert client.get(f"/api/share/{slug}", headers=invitee).status_code == 403
    assert client.get("/api/projects/shared", headers=invitee).json()["total"] == 0


def test_turning_sharing_off_kills_the_old_link_and_rotating_replaces_it(
    client: TestClient,
):
    owner = register(client)
    project = create_project(client, owner)
    first = share(client, owner, project["id"], role="editor")["slug"]

    rotated = client.post(
        f"/api/projects/{project['id']}/share/rotate", headers=owner
    )
    assert rotated.status_code == 200, rotated.text
    second = rotated.json()["slug"]
    assert second != first
    assert client.get(f"/api/share/{first}").status_code == 404
    assert client.get(f"/api/share/{second}").status_code == 200

    disabled = share(client, owner, project["id"], enabled=False)
    assert disabled["enabled"] is False
    assert disabled["slug"] is None
    assert client.get(f"/api/share/{second}").status_code == 404

    # Re-enabling creates a brand-new capability, never the retired one.
    reenabled = share(client, owner, project["id"], role="viewer")
    assert reenabled["slug"] not in {first, second}
    assert client.get(f"/api/share/{reenabled['slug']}").status_code == 200


def test_owner_cannot_invite_their_own_email(client: TestClient):
    owner = register(client)
    project = create_project(client, owner)
    response = client.post(
        f"/api/projects/{project['id']}/members",
        json={"email": "kivic@example.com", "role": "editor"},
        headers=owner,
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "cannot_invite_owner"


def test_share_settings_requires_the_owner(client: TestClient):
    owner = register(client)
    stranger = register(client, email="other@example.com")
    project = create_project(client, owner)
    assert client.get(f"/api/projects/{project['id']}/share", headers=stranger).status_code == 404
    assert (
        client.put(
            f"/api/projects/{project['id']}/share",
            json={"enabled": True},
            headers=stranger,
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/projects/{project['id']}/members",
            json={"email": "x@example.com"},
            headers=stranger,
        ).status_code
        == 404
    )
