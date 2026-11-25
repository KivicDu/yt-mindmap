"""SSE access: the stream follows the share role and can be revoked live."""

import asyncio
import time

from fastapi.testclient import TestClient

import main as main_module
from app.services import stream_tickets

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


def register(client: TestClient, email: str = "owner@example.com") -> dict[str, str]:
    body = client.post(
        "/api/auth/register",
        json={"email": email, "password": "hunter2pass", "display_name": "Kivic"},
    ).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def create_project(client: TestClient, headers: dict[str, str]) -> dict:
    response = client.post(
        "/api/projects",
        json={
            "title": "Python cơ bản",
            "video_id": "abcdefghijk",
            "nodes": NODES,
            "transcript": CUES,
            "transcript_language": "vi",
            "consumed_until": 8.0,
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def share(
    client: TestClient,
    headers: dict[str, str],
    project_id: str,
    *,
    enabled: bool = True,
    access: str = "anyone",
) -> None:
    response = client.put(
        f"/api/projects/{project_id}/share",
        json={"enabled": enabled, "access": access, "role": "viewer"},
        headers=headers,
    )
    assert response.status_code == 200, response.text


def unlisted_session(client: TestClient):
    owner = register(client)
    project = create_project(client, owner)
    share(client, owner, project["id"])
    opened = client.post(
        "/transcript", json={"project_id": project["id"]}, headers=owner
    ).json()
    return owner, project, opened["session_id"]


def test_share_page_receives_a_ticket_not_a_bearer_token(client: TestClient):
    owner, _, session_id = unlisted_session(client)
    listed = client.get("/api/projects", headers=owner).json()
    slug = listed["items"][0]["share_slug"]
    view = client.get(f"/api/share/{slug}").json()

    ticket = view["stream_ticket"]
    assert ticket and len(ticket) == 32
    resolved = stream_tickets.resolve(main_module.sessions, ticket)
    assert resolved is not None
    assert resolved[0] == session_id
    assert resolved[2]["user_id"] is None

    # A raw session id is no longer a valid stream capability.
    rejected = client.get(f"/stream/{session_id}")
    assert rejected.status_code == 403
    assert rejected.json()["detail"]["code"] == "stream_ticket_invalid"


def test_ticket_endpoint_checks_the_share_role(client: TestClient):
    owner, project, session_id = unlisted_session(client)
    stranger = register(client, "stranger@example.com")

    allowed = client.post(f"/session/{session_id}/stream-ticket", headers=owner)
    assert allowed.status_code == 200
    assert allowed.json()["expires_in"] == stream_tickets.TICKET_TTL_SECONDS

    # An unlisted link grants the viewer role to anyone holding its session.
    anonymous = client.post(f"/session/{session_id}/stream-ticket")
    assert anonymous.status_code == 200

    share(client, owner, project["id"], access="invited")
    denied = client.post(f"/session/{session_id}/stream-ticket", headers=stranger)
    assert denied.status_code == 403
    assert denied.json()["detail"]["code"] == "stream_forbidden"
    guest = client.post(f"/session/{session_id}/stream-ticket")
    assert guest.status_code == 403

    missing = client.post("/session/gone/stream-ticket", headers=owner)
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "session_lost"


def test_revoking_a_link_closes_an_open_stream(client: TestClient, db_session, monkeypatch):
    owner, project, session_id = unlisted_session(client)
    # The revoked identity is the link holder, not the owner (owners keep
    # access to their own project after turning the public link off).
    ticket = client.post(f"/session/{session_id}/stream-ticket").json()["ticket"]
    monkeypatch.setattr(main_module, "STREAM_RECHECK_TICKS", 1)

    share(client, owner, project["id"], enabled=False)

    async def first_event():
        response = await main_module.stream_updates(ticket, db_session)
        async for item in response.body_iterator:
            return item
        return None

    event = asyncio.run(asyncio.wait_for(first_event(), timeout=5))
    assert event is not None
    assert '"access_revoked"' in event["data"]


def test_expired_tickets_cannot_open_a_stream(client: TestClient):
    owner, _, session_id = unlisted_session(client)
    ticket = client.post(
        f"/session/{session_id}/stream-ticket", headers=owner
    ).json()["ticket"]
    session = main_module.sessions[session_id]
    session["stream_tickets"][ticket]["expires_at"] = time.time() - 1

    assert stream_tickets.resolve(main_module.sessions, ticket) is None
    response = client.get(f"/stream/{ticket}")
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "stream_ticket_invalid"
