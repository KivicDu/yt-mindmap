"""ADR 0014 endpoints: countable fractions, cached keys, opt-in review."""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session

import ai_engine as ai_module
from app.models.project import Project

LABELS = {
    "n0": "Hàm số",
    "n1": "Đạo hàm",
    "n2": "Tích phân",
    "n3": "Giới hạn",
    "n4": "Liên tục",
    "n5": "Cực trị",
    "n6": "Đồ thị",
    "n7": "Ứng dụng",
}
NODES = [
    {
        "id": key,
        "parentId": None,
        "label": label,
        "note": f"ghi chú của {label}",
        "time": float(index * 60),
        "children": [],
    }
    for index, (key, label) in enumerate(LABELS.items())
]


def register(client: TestClient, email: str) -> dict[str, str]:
    body = client.post(
        "/api/auth/register",
        json={"email": email, "password": "hunter2pass", "display_name": "Kivic"},
    ).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def create_project(client: TestClient, headers: dict[str, str]) -> dict:
    response = client.post(
        "/api/projects",
        json={
            "title": "Giải tích",
            "video_id": "abcdefghijk",
            "nodes": NODES,
            "transcript": [{"start": 0.0, "duration": 480.0, "text": "bài giảng"}],
            "consumed_until": 480.0,
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


def quiz(client: TestClient, headers, project_id: str, attempt: int = 0) -> dict:
    response = client.post(
        f"/api/projects/{project_id}/quiz", json={"attempt": attempt}, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_quiz_hides_the_key_is_cached_and_a_retry_resamples(client: TestClient):
    headers = register(client, "owner@example.com")
    project = create_project(client, headers)

    first = quiz(client, headers, project["id"])
    assert first["quiz_id"]
    assert 5 <= len(first["targets"]) <= 8
    assert all("label" not in item and "note" not in item for item in first["targets"])
    assert all("key" not in question for question in first["questions"])

    again = quiz(client, headers, project["id"])
    assert again["quiz_id"] == first["quiz_id"]

    retry = quiz(client, headers, project["id"], attempt=1)
    assert [item["id"] for item in retry["targets"]] != [item["id"] for item in first["targets"]]


def test_short_project_gets_a_friendly_message(client: TestClient):
    headers = register(client, "short@example.com")
    project = create_project(client, headers)
    response = client.patch(
        f"/api/projects/{project['id']}",
        json={"nodes": NODES[:3]},
        headers=headers,
    )
    assert response.status_code == 200, response.text

    body = quiz(client, headers, project["id"])
    assert body["targets"] == [] and body["quiz_id"] == ""
    assert "quá ngắn" in body["note"]


def test_attempt_stores_fractions_and_never_a_percentage(client: TestClient, monkeypatch):
    monkeypatch.setattr(
        ai_module.ai_engine,
        "generate_quiz",
        lambda _markdown: {
            "questions": [{"id": "q1", "prompt": "Ý chính là gì?", "expected": "Hàm số"}]
        },
    )
    headers = register(client, "grader@example.com")
    project = create_project(client, headers)
    questions = quiz(client, headers, project["id"])
    targets = questions["targets"]

    recall = []
    for index, target in enumerate(targets):
        answer = LABELS[target["id"]] if index % 2 == 0 else "không liên quan gì cả"
        recall.append({"node_id": target["id"], "answer": answer})

    response = client.post(
        f"/api/projects/{project['id']}/attempt",
        json={
            "quiz_id": questions["quiz_id"],
            "attempt": 0,
            "recall": recall,
            "ideas": [{"id": "q1", "answer": "hàm số"}],
            # Sorted, validated before storage.
            "weak_ranges": [[120, 180]],
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["recall"]["asked"] == len(targets)
    assert body["recall"]["correct"] == (len(targets) + 1) // 2
    assert body["ideas"]["correct"] == 1 and body["ideas"]["asked"] == 1
    assert body["weak_ranges"] == [[120.0, 180.0]]
    assert "nhánh" in body["message"] and "ý chính" in body["message"]
    assert "percent" not in body and "score" not in body and "%" not in body["message"]
    assert all("original" in item for item in body["recall"]["items"])


def test_learner_can_override_a_mark(client: TestClient):
    headers = register(client, "override@example.com")
    project = create_project(client, headers)
    questions = quiz(client, headers, project["id"])
    wrong = questions["targets"][0]

    response = client.post(
        f"/api/projects/{project['id']}/attempt",
        json={
            "quiz_id": questions["quiz_id"],
            "recall": [{"node_id": wrong["id"], "answer": "đáp án hoàn toàn khác"}],
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    result = response.json()["recall"]
    assert result["correct"] == 0
    item = result["items"][0]
    assert item["original"] is False and item["key"]

    patched = client.patch(
        f"/api/review/attempts/{result['id']}",
        json={"item_id": item["id"], "correct": True},
        headers=headers,
    )
    assert patched.status_code == 200, patched.text
    changed = patched.json()
    assert changed["correct"] == 1
    assert changed["overridden"] == 1
    assert changed["items"][0]["original"] is False


def test_review_is_opt_in_and_due_is_lazy(client: TestClient, db_session: Session):
    headers = register(client, "review@example.com")
    project = create_project(client, headers)
    project_id = project["id"]

    assert client.get("/api/review/due", headers=headers).json() == []

    enabled = client.patch(
        f"/api/projects/{project_id}/review", json={"enabled": True}, headers=headers
    )
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["enabled"] is True
    assert client.get("/api/review/due", headers=headers).json() == []

    yesterday = datetime.now(UTC) - timedelta(days=1)
    db_session.execute(
        update(Project).where(Project.id == project_id).values(next_review_at=yesterday)
    )
    db_session.commit()

    due = client.get("/api/review/due", headers=headers).json()
    assert [item["id"] for item in due] == [project_id]
    assert due[0]["node_count"] == len(NODES)

    disabled = client.patch(
        f"/api/projects/{project_id}/review", json={"enabled": False}, headers=headers
    )
    assert disabled.json() == {"enabled": False, "next_review_at": None}
    assert client.get("/api/review/due", headers=headers).json() == []


def test_viewer_cannot_check_but_editor_can(client: TestClient, db_session: Session):
    owner = register(client, "link-owner@example.com")
    other = register(client, "link-editor@example.com")
    project = create_project(client, owner)
    project_id = project["id"]

    db_session.execute(
        update(Project)
        .where(Project.id == project_id)
        .values(visibility="unlisted", share_slug="YTMM-checklink01", link_role="viewer")
    )
    db_session.commit()

    denied = client.post(f"/api/projects/{project_id}/quiz", json={}, headers=other)
    assert denied.status_code == 403

    db_session.execute(
        update(Project).where(Project.id == project_id).values(link_role="editor")
    )
    db_session.commit()

    allowed = client.post(f"/api/projects/{project_id}/quiz", json={}, headers=other)
    assert allowed.status_code == 200, allowed.text


def test_quiz_needs_a_signed_in_caller(client: TestClient):
    project = {"id": "whatever"}
    response = client.post(f"/api/projects/{project['id']}/quiz", json={})
    assert response.status_code == 401
