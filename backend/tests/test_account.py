"""Phase 4 account features: profile, password, verification and revocation."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.base import utcnow
from app.models.email_verification import EmailVerificationToken
from app.models.user import User
from app.utils.security import create_token

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


def login(client: TestClient, password: str = PASSWORD) -> int:
    return client.post(
        "/api/auth/login",
        json={"email": "kivic@example.com", "password": password},
    ).status_code


# ---------------------------------------------------------------- profile


def test_profile_update_changes_the_display_name(client: TestClient):
    body = register(client)
    headers = auth_headers(body)

    response = client.patch(
        "/api/auth/me",
        json={"display_name": "  Kivic Mới  "},
        headers=headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["display_name"] == "Kivic Mới"
    assert client.get("/api/auth/me", headers=headers).json()["display_name"] == "Kivic Mới"


def test_profile_update_rejects_a_blank_display_name(client: TestClient):
    body = register(client)

    response = client.patch(
        "/api/auth/me",
        json={"display_name": "   "},
        headers=auth_headers(body),
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "display_name_required"


def test_profile_update_requires_authentication(client: TestClient):
    assert client.patch("/api/auth/me", json={"display_name": "X"}).status_code == 401


# ---------------------------------------------------------------- password


def test_password_change_requires_the_current_password(client: TestClient):
    body = register(client)

    response = client.post(
        "/api/auth/password",
        json={"current_password": "wrongpass", "new_password": "brandnewpass"},
        headers=auth_headers(body),
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "wrong_password"


def test_password_change_rotates_the_password_and_the_session(client: TestClient):
    body = register(client)
    old_refresh = client.cookies.get("ytmm_refresh_token")

    response = client.post(
        "/api/auth/password",
        json={"current_password": PASSWORD, "new_password": "brandnewpass"},
        headers=auth_headers(body),
    )

    assert response.status_code == 204, response.text
    new_refresh = client.cookies.get("ytmm_refresh_token")
    assert new_refresh and new_refresh != old_refresh

    # The current device stays signed in and can refresh with the new cookie.
    assert client.post("/api/auth/refresh").status_code == 200
    # The old password is gone; the new one works.
    assert login(client, PASSWORD) == 401
    assert login(client, "brandnewpass") == 200


def test_password_change_revokes_other_devices(client: TestClient):
    body = register(client)
    old_refresh = client.cookies.get("ytmm_refresh_token")

    assert (
        client.post(
            "/api/auth/password",
            json={"current_password": PASSWORD, "new_password": "brandnewpass"},
            headers=auth_headers(body),
        ).status_code
        == 204
    )

    client.cookies.clear()
    client.cookies.set("ytmm_refresh_token", old_refresh)
    response = client.post("/api/auth/refresh")

    assert response.status_code == 401
    assert response.json()["detail"] == "invalid_refresh_token"


def test_password_change_rejects_an_oauth_only_account(
    client: TestClient, db_session: Session
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
    token, _ = create_token(user.id, "access")

    response = client.post(
        "/api/auth/password",
        json={"current_password": PASSWORD, "new_password": "brandnewpass"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "password_not_set"


# ---------------------------------------------------------------- revocation


def test_logout_revokes_the_refresh_token(client: TestClient):
    register(client)
    refresh_token = client.cookies.get("ytmm_refresh_token")

    assert client.post("/api/auth/logout").status_code == 204

    client.cookies.clear()
    client.cookies.set("ytmm_refresh_token", refresh_token)
    response = client.post("/api/auth/refresh")

    assert response.status_code == 401
    assert response.json()["detail"] == "invalid_refresh_token"


def test_refresh_token_rotation_rejects_replay(client: TestClient):
    register(client)
    first = client.cookies.get("ytmm_refresh_token")

    assert client.post("/api/auth/refresh").status_code == 200
    second = client.cookies.get("ytmm_refresh_token")
    assert second and second != first

    client.cookies.clear()
    client.cookies.set("ytmm_refresh_token", first)
    response = client.post("/api/auth/refresh")

    assert response.status_code == 401
    assert response.json()["detail"] == "invalid_refresh_token"


# ---------------------------------------------------------------- verification


@pytest.fixture()
def debug_links(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "DEBUG_EMAIL_LINKS", True)


def request_link(client: TestClient, headers: dict[str, str]) -> str:
    response = client.post("/api/auth/verification/request", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "sent"
    assert body["dev_link"], "DEBUG_EMAIL_LINKS should expose the link in tests"
    return body["dev_link"].split("token=", 1)[1]


def test_email_verification_marks_the_account_verified(
    client: TestClient, debug_links: None
):
    body = register(client)
    headers = auth_headers(body)
    assert body["user"]["email_verified"] is False

    token = request_link(client, headers)

    # Confirming does not require a session: the link may open in a new browser.
    response = client.post("/api/auth/verification/confirm", json={"token": token})

    assert response.status_code == 200, response.text
    assert response.json()["email_verified"] is True
    assert client.get("/api/auth/me", headers=headers).json()["email_verified"] is True


def test_verification_token_is_single_use(client: TestClient, debug_links: None):
    body = register(client)
    token = request_link(client, auth_headers(body))

    assert (
        client.post("/api/auth/verification/confirm", json={"token": token}).status_code
        == 200
    )
    replay = client.post("/api/auth/verification/confirm", json={"token": token})

    assert replay.status_code == 400
    assert replay.json()["detail"] == "invalid_verification_token"


def test_requesting_a_new_link_invalidates_the_old_one(
    client: TestClient, debug_links: None
):
    body = register(client)
    headers = auth_headers(body)
    first = request_link(client, headers)
    second = request_link(client, headers)
    assert first != second

    assert (
        client.post("/api/auth/verification/confirm", json={"token": first}).status_code
        == 400
    )
    assert (
        client.post("/api/auth/verification/confirm", json={"token": second}).status_code
        == 200
    )


def test_expired_verification_token_is_rejected(
    client: TestClient, db_session: Session, debug_links: None
):
    body = register(client)
    token = request_link(client, auth_headers(body))

    row = db_session.query(EmailVerificationToken).one()
    row.expires_at = utcnow() - timedelta(hours=1)
    db_session.commit()

    response = client.post("/api/auth/verification/confirm", json={"token": token})

    assert response.status_code == 400
    assert response.json()["detail"] == "invalid_verification_token"


def test_verification_request_is_idempotent_when_already_verified(
    client: TestClient, debug_links: None
):
    body = register(client)
    headers = auth_headers(body)
    token = request_link(client, headers)
    client.post("/api/auth/verification/confirm", json={"token": token})

    response = client.post("/api/auth/verification/request", headers=headers)

    assert response.status_code == 200
    assert response.json() == {"status": "already_verified", "dev_link": None}


def test_verification_request_requires_authentication(client: TestClient):
    assert client.post("/api/auth/verification/request").status_code == 401
