"""Hard account deletion: confirmation, cascade cleanup and final notice."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.account_token import AccountToken
from app.models.project import Project
from app.models.project_member import ProjectMember
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.services import account_emails

PASSWORD = "hunter2pass"


def register(
    client: TestClient,
    email: str = "kivic@example.com",
    password: str = PASSWORD,
) -> dict:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "display_name": "Kivic"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def auth_headers(body: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {body['access_token']}"}


@pytest.fixture()
def outbox(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    sent: list[dict] = []

    def fake_send_email(*, to: str, subject: str, text: str, html: str | None = None) -> None:
        sent.append({"to": to, "subject": subject, "text": text, "html": html})

    monkeypatch.setattr(account_emails, "send_email", fake_send_email)
    return sent


def test_delete_requires_authentication(client: TestClient):
    response = client.post(
        "/api/auth/account/delete",
        json={"confirm_email": "kivic@example.com", "password": PASSWORD},
    )
    assert response.status_code == 401


def test_delete_rejects_a_mismatched_email(client: TestClient):
    body = register(client)

    response = client.post(
        "/api/auth/account/delete",
        json={"confirm_email": "other@example.com", "password": PASSWORD},
        headers=auth_headers(body),
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "email_mismatch"


def test_delete_requires_the_correct_password(client: TestClient):
    body = register(client)

    response = client.post(
        "/api/auth/account/delete",
        json={"confirm_email": "kivic@example.com", "password": "wrongpass"},
        headers=auth_headers(body),
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "wrong_password"


def test_delete_removes_the_account_and_everything_attached(
    client: TestClient,
    db_session: Session,
    outbox: list[dict],
):
    body = register(client)
    user_id = body["user"]["id"]

    project = Project(user_id=user_id, title="Bài giảng")
    db_session.add(project)
    db_session.flush()
    db_session.add(ProjectMember(project_id="someone-elses-project", email="kivic@example.com"))
    db_session.add(ProjectMember(project_id=project.id, email="friend@example.com"))
    db_session.commit()
    project_id = project.id

    response = client.post(
        "/api/auth/account/delete",
        json={"confirm_email": "KIVIC@example.com", "password": PASSWORD},
        headers=auth_headers(body),
    )

    assert response.status_code == 204, response.text
    assert "ytmm_refresh_token=" in response.headers["set-cookie"]
    db_session.expunge_all()
    assert db_session.get(User, user_id) is None
    assert db_session.get(Project, project_id) is None
    assert db_session.scalar(
        select(func.count()).select_from(ProjectMember)
    ) == 0
    assert db_session.scalar(
        select(func.count()).select_from(RefreshToken)
    ) == 0
    assert db_session.scalar(
        select(func.count()).select_from(AccountToken)
    ) == 0

    assert len(outbox) == 1
    assert outbox[0]["to"] == "kivic@example.com"
    assert "đã được xoá" in outbox[0]["subject"]

    # The old access token no longer resolves to a user.
    assert client.get("/api/auth/me", headers=auth_headers(body)).status_code == 401


def test_oauth_only_account_needs_no_password(
    client: TestClient, db_session: Session, outbox: list[dict]
):
    user = User(
        email="oauth@example.com",
        display_name="OAuth",
        provider="google",
        provider_id="google:123",
        email_verified=True,
    )
    db_session.add(user)
    db_session.commit()

    from app.utils.security import create_token

    token, _ = create_token(user.id, "access")
    user_id = user.id
    response = client.post(
        "/api/auth/account/delete",
        json={"confirm_email": "oauth@example.com"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 204, response.text
    db_session.expunge_all()
    assert db_session.get(User, user_id) is None
    assert len(outbox) == 1
