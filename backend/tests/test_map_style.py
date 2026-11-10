"""The map style is part of a saved project: layout plus pastel palette."""

from fastapi.testclient import TestClient

NODES = [
    {
        "id": "n1",
        "parentId": None,
        "label": "Tổng quan",
        "time": 0.0,
        "note": "",
        "pinned": False,
        "children": [],
    }
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
        "transcript": [],
        "consumed_until": 8.0,
    }
    payload.update(overrides)
    response = client.post("/api/projects", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_style_defaults_keep_older_maps_on_the_tree_layout(client: TestClient):
    headers = register(client)
    project = create_project(client, headers)

    assert project["map_layout"] == "tree"
    assert project["map_palette"] == "paper"

    # The list and the detail payload agree, so a dashboard card can show the
    # same thumbnail as the workspace.
    listed = client.get("/api/projects", headers=headers).json()["items"][0]
    assert (listed["map_layout"], listed["map_palette"]) == ("tree", "paper")


def test_style_is_saved_and_updated(client: TestClient):
    headers = register(client)
    project = create_project(
        client, headers, map_layout="spider", map_palette="sage"
    )
    assert (project["map_layout"], project["map_palette"]) == ("spider", "sage")

    updated = client.patch(
        f"/api/projects/{project['id']}",
        json={"map_layout": "bubble", "map_palette": "lilac"},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    assert (updated.json()["map_layout"], updated.json()["map_palette"]) == (
        "bubble",
        "lilac",
    )

    # A partial update leaves the field it did not send alone.
    renamed = client.patch(
        f"/api/projects/{project['id']}",
        json={"title": "Đại số"},
        headers=headers,
    ).json()
    assert (renamed["map_layout"], renamed["map_palette"]) == ("bubble", "lilac")


def test_unknown_layout_or_palette_is_rejected(client: TestClient):
    headers = register(client)

    bad_layout = client.post(
        "/api/projects",
        json={"title": "X", "map_layout": "radial-9000"},
        headers=headers,
    )
    assert bad_layout.status_code == 422

    bad_palette = client.post(
        "/api/projects",
        json={"title": "X", "map_palette": "neon"},
        headers=headers,
    )
    assert bad_palette.status_code == 422


def test_duplicate_copies_the_style(client: TestClient):
    headers = register(client)
    project = create_project(client, headers, map_layout="circle", map_palette="sky")

    copy = client.post(f"/api/projects/{project['id']}/duplicate", headers=headers)
    assert copy.status_code == 201, copy.text
    assert (copy.json()["map_layout"], copy.json()["map_palette"]) == ("circle", "sky")
