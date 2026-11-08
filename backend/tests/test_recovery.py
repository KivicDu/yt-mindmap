"""Phase 5 recovery flows: forgot/reset password and email change."""

import re
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.base import utcnow
from app.models.account_token import AccountToken
from app.models.user import User
from app.services import account_emails
from app.services.emailer import EmailDeliveryError
from app.utils.security import create_token, hash_password

PASSWORD = "hunter2pass"
NEW_PASSWORD = "brandnewpass"


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


def login(client: TestClient, email: str, password: str) -> int:
    return client.post(
        "/api/auth/login", json={"email": email, "password": password}
    ).status_code


@pytest.fixture()
def outbox(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    sent: list[dict] = []

    def fake_send_email(*, to: str, subject: str, text: str, html: str | None = None) -> None:
        sent.append({"to": to, "subject": subject, "text": text, "html": html})

    monkeypatch.setattr(account_emails, "send_email", fake_send_email)
    return sent


@pytest.fixture()
def debug_links(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "DEBUG_EMAIL_LINKS", True)


def link_token(message: dict) -> str:
    link = re.search(r"https?://\S+", message["text"])
    assert link is not None, message["text"]
    return link.group(0).split("token=", 1)[1]


# ---------------------------------------------------------------- forgot


def test_forgot_password_sends_a_link_to_a_local_account(
    client: TestClient, outbox: list[dict]
):
    register(client)

    response = client.post(
        "/api/auth/password/forgot", json={"email": "KIVIC@example.com"}
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"status": "sent"}
    assert len(outbox) == 1
    assert outbox[0]["to"] == "kivic@example.com"
    assert "reset-password" in outbox[0]["text"]


def test_forgot_password_does_not_reveal_unknown_addresses(
    client: TestClient, outbox: list[dict]
):
    response = client.post(
        "/api/auth/password/forgot", json={"email": "nobody@example.com"}
    )

    assert response.status_code == 200
    assert response.json() == {"status": "sent"}
    assert outbox == []


def test_forgot_password_skips_oauth_only_accounts(
    client: TestClient, db_session: Session, outbox: list[dict]
):
    db_session.add(
        User(
            email="oauth@example.com",
            display_name="OAuth",
            provider="google",
            provider_id="google:123",
            email_verified=True,
        )
    )
    db_session.commit()

    response = client.post(
        "/api/auth/password/forgot", json={"email": "oauth@example.com"}
    )

    assert response.status_code == 200
    assert outbox == []


def test_forgot_password_cooldown_keeps_the_first_link(
    client: TestClient, outbox: list[dict]
):
    register(client)

    first = client.post(
        "/api/auth/password/forgot", json={"email": "kivic@example.com"}
    )
    second = client.post(
        "/api/auth/password/forgot", json={"email": "kivic@example.com"}
    )

    assert first.status_code == second.status_code == 200
    assert len(outbox) == 1
    # The first link is still usable.
    token = link_token(outbox[0])
    assert (
        client.post(
            "/api/auth/password/reset",
            json={"token": token, "new_password": NEW_PASSWORD},
        ).status_code
        == 204
    )


# ---------------------------------------------------------------- reset


def test_password_reset_changes_the_password_and_revokes_sessions(
    client: TestClient, outbox: list[dict]
):
    register(client)
    old_refresh = client.cookies.get("ytmm_refresh_token")

    client.post("/api/auth/password/forgot", json={"email": "kivic@example.com"})
    token = link_token(outbox[0])

    response = client.post(
        "/api/auth/password/reset",
        json={"token": token, "new_password": NEW_PASSWORD},
    )

    assert response.status_code == 204, response.text
    assert login(client, "kivic@example.com", PASSWORD) == 401
    assert login(client, "kivic@example.com", NEW_PASSWORD) == 200

    client.cookies.clear()
    client.cookies.set("ytmm_refresh_token", old_refresh)
    assert client.post("/api/auth/refresh").status_code == 401


def test_password_reset_token_is_single_use(client: TestClient, outbox: list[dict]):
    register(client)
    client.post("/api/auth/password/forgot", json={"email": "kivic@example.com"})
    token = link_token(outbox[0])

    assert (
        client.post(
            "/api/auth/password/reset",
            json={"token": token, "new_password": NEW_PASSWORD},
        ).status_code
        == 204
    )
    replay = client.post(
        "/api/auth/password/reset",
        json={"token": token, "new_password": "anotherpass"},
    )

    assert replay.status_code == 400
    assert replay.json()["detail"] == "invalid_reset_token"


def test_expired_password_reset_token_is_rejected(
    client: TestClient, db_session: Session, outbox: list[dict]
):
    register(client)
    client.post("/api/auth/password/forgot", json={"email": "kivic@example.com"})
    token = link_token(outbox[0])

    row = db_session.query(AccountToken).one()
    row.expires_at = utcnow() - timedelta(minutes=1)
    db_session.commit()

    response = client.post(
        "/api/auth/password/reset",
        json={"token": token, "new_password": NEW_PASSWORD},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "invalid_reset_token"


# ---------------------------------------------------------------- email change


def test_email_change_requires_the_current_password(
    client: TestClient, outbox: list[dict]
):
    body = register(client)

    response = client.post(
        "/api/auth/email/request",
        json={"new_email": "new@example.com", "current_password": "wrongpass"},
        headers=auth_headers(body),
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "wrong_password"
    assert outbox == []


def test_email_change_rejects_an_address_already_in_use(
    client: TestClient, db_session: Session
):
    body = register(client)
    db_session.add(
        User(
            email="taken@example.com",
            display_name="Taken",
            password_hash=hash_password(PASSWORD),
            provider="local",
        )
    )
    db_session.commit()

    response = client.post(
        "/api/auth/email/request",
        json={"new_email": "taken@example.com", "current_password": PASSWORD},
        headers=auth_headers(body),
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "email_taken"


def test_email_change_rejects_the_same_address(
    client: TestClient, outbox: list[dict]
):
    body = register(client)

    response = client.post(
        "/api/auth/email/request",
        json={"new_email": "kivic@example.com", "current_password": PASSWORD},
        headers=auth_headers(body),
    )

    assert response.status_code == 200
    assert response.json() == {"status": "unchanged", "dev_link": None}
    assert outbox == []


def test_email_change_confirms_the_new_address_and_revokes_sessions(
    client: TestClient, outbox: list[dict], debug_links: None
):
    body = register(client)
    old_refresh = client.cookies.get("ytmm_refresh_token")

    request = client.post(
        "/api/auth/email/request",
        json={"new_email": "new@example.com", "current_password": PASSWORD},
        headers=auth_headers(body),
    )

    assert request.status_code == 200, request.text
    assert request.json()["status"] == "sent"
    assert request.json()["dev_link"]
    assert outbox[0]["to"] == "new@example.com"
    token = link_token(outbox[0])

    confirm = client.post("/api/auth/email/confirm", json={"token": token})

    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["email"] == "new@example.com"
    assert confirm.json()["email_verified"] is True

    # The old address is gone, the new one works, and old sessions are dead.
    assert login(client, "kivic@example.com", PASSWORD) == 401
    assert login(client, "new@example.com", PASSWORD) == 200
    client.cookies.clear()
    client.cookies.set("ytmm_refresh_token", old_refresh)
    assert client.post("/api/auth/refresh").status_code == 401

    # The old inbox receives a security notice.
    assert outbox[-1]["to"] == "kivic@example.com"
    assert "new@example.com" in outbox[-1]["text"]


def test_email_change_token_is_single_use(
    client: TestClient, outbox: list[dict], debug_links: None
):
    body = register(client)
    client.post(
        "/api/auth/email/request",
        json={"new_email": "new@example.com", "current_password": PASSWORD},
        headers=auth_headers(body),
    )
    token = link_token(outbox[0])

    assert (
        client.post("/api/auth/email/confirm", json={"token": token}).status_code
        == 200
    )
    replay = client.post("/api/auth/email/confirm", json={"token": token})

    assert replay.status_code == 400
    assert replay.json()["detail"] == "invalid_email_change_token"


def test_email_change_confirm_rechecks_the_address(
    client: TestClient, db_session: Session, outbox: list[dict], debug_links: None
):
    body = register(client)
    client.post(
        "/api/auth/email/request",
        json={"new_email": "new@example.com", "current_password": PASSWORD},
        headers=auth_headers(body),
    )
    token = link_token(outbox[0])

    db_session.add(
        User(
            email="new@example.com",
            display_name="Racer",
            password_hash=hash_password(PASSWORD),
            provider="local",
        )
    )
    db_session.commit()

    response = client.post("/api/auth/email/confirm", json={"token": token})

    assert response.status_code == 409
    assert response.json()["detail"] == "email_taken"


def test_expired_email_change_token_is_rejected(
    client: TestClient, db_session: Session, outbox: list[dict], debug_links: None
):
    body = register(client)
    client.post(
        "/api/auth/email/request",
        json={"new_email": "new@example.com", "current_password": PASSWORD},
        headers=auth_headers(body),
    )
    token = link_token(outbox[0])

    row = db_session.query(AccountToken).one()
    row.expires_at = utcnow() - timedelta(minutes=1)
    db_session.commit()

    response = client.post("/api/auth/email/confirm", json={"token": token})

    assert response.status_code == 400
    assert response.json()["detail"] == "invalid_email_change_token"


def test_email_change_for_an_oauth_account_needs_no_password(
    client: TestClient, db_session: Session, outbox: list[dict], debug_links: None
):
    user = User(
        email="oauth@example.com",
        display_name="OAuth",
        provider="github",
        provider_id="github:123",
        email_verified=True,
    )
    db_session.add(user)
    db_session.commit()
    token, _ = create_token(user.id, "access")

    request = client.post(
        "/api/auth/email/request",
        json={"new_email": "oauth-new@example.com"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert request.status_code == 200, request.text
    confirm = client.post(
        "/api/auth/email/confirm", json={"token": link_token(outbox[0])}
    )
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["email"] == "oauth-new@example.com"


def test_email_change_requires_authentication(client: TestClient):
    assert (
        client.post(
            "/api/auth/email/request",
            json={"new_email": "new@example.com", "current_password": PASSWORD},
        ).status_code
        == 401
    )


# ---------------------------------------------------------------- delivery


def test_email_delivery_failure_returns_502_and_allows_a_retry(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    body = register(client)

    def fail(*args, **kwargs):
        raise EmailDeliveryError("smtp_send_failed")

    monkeypatch.setattr(account_emails, "send_email", fail)
    first = client.post("/api/auth/verification/request", headers=auth_headers(body))
    assert first.status_code == 502
    assert first.json()["detail"] == "email_delivery_failed"

    sent: list[dict] = []
    monkeypatch.setattr(
        account_emails,
        "send_email",
        lambda *, to, subject, text, html=None: sent.append({"to": to}),
    )
    second = client.post("/api/auth/verification/request", headers=auth_headers(body))
    assert second.status_code == 200
    assert len(sent) == 1
