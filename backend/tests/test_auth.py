"""Auth endpoints, exercised against an in-memory SQLite database."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import User
from app.utils.security import create_token


def register(client: TestClient, email: str = "kivic@example.com", password: str = "hunter2pass"):
    return client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "display_name": "Kivic"},
    )


def test_register_creates_user_and_sets_httponly_cookie(client: TestClient):
    response = register(client)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0
    assert body["user"]["email"] == "kivic@example.com"
    assert body["user"]["display_name"] == "Kivic"
    assert body["user"]["provider"] == "local"
    assert body["user"]["email_verified"] is False

    cookie_header = response.headers["set-cookie"]
    assert "ytmm_refresh_token=" in cookie_header
    assert "HttpOnly" in cookie_header
    assert "Path=/" in cookie_header


def test_register_normalizes_email_and_rejects_duplicates(client: TestClient):
    assert register(client, email="Kivic@Example.com").status_code == 201
    duplicate = register(client, email="  kivic@example.com ")
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "email_taken"


def test_register_rejects_short_password(client: TestClient):
    response = client.post(
        "/api/auth/register",
        json={"email": "a@b.com", "password": "short", "display_name": "A"},
    )
    assert response.status_code == 422


def test_login_rejects_wrong_password(client: TestClient):
    register(client)
    response = client.post(
        "/api/auth/login", json={"email": "kivic@example.com", "password": "wrongpass"}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid_credentials"


def test_login_accepts_the_same_credentials(client: TestClient):
    register(client)
    response = client.post(
        "/api/auth/login", json={"email": "kivic@example.com", "password": "hunter2pass"}
    )
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "kivic@example.com"


def test_me_requires_and_accepts_a_bearer_token(client: TestClient):
    token = register(client).json()["access_token"]
    assert client.get("/api/auth/me").status_code == 401
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["email"] == "kivic@example.com"


def test_me_rejects_a_refresh_token(client: TestClient):
    user_id = register(client).json()["user"]["id"]
    refresh_token, _ = create_token(user_id, "refresh")
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {refresh_token}"})
    assert response.status_code == 401


def test_refresh_rotates_the_cookie_and_returns_a_new_access_token(client: TestClient):
    register(client)
    first_cookie = client.cookies.get("ytmm_refresh_token")

    response = client.post("/api/auth/refresh")
    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    assert body["expires_in"] > 0

    second_cookie = response.cookies.get("ytmm_refresh_token")
    assert second_cookie
    assert second_cookie != first_cookie

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200


def test_refresh_without_cookie_fails(client: TestClient):
    response = client.post("/api/auth/refresh")
    assert response.status_code == 401
    assert response.json()["detail"] == "missing_refresh_token"


def test_refresh_with_access_token_cookie_fails(client: TestClient):
    user_id = register(client).json()["user"]["id"]
    access_token, _ = create_token(user_id, "access")
    # register() already stored a real refresh cookie. Clear the jar first:
    # httpx keeps both cookies when the domain differs and then sends
    # "ytmm_refresh_token=real; ytmm_refresh_token=<access>", so the request
    # would carry a valid refresh token and the test would prove nothing.
    client.cookies.clear()
    client.cookies.set("ytmm_refresh_token", access_token)
    response = client.post("/api/auth/refresh")
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid_refresh_token"


def test_logout_clears_the_cookie(client: TestClient):
    register(client)
    response = client.post("/api/auth/logout")
    assert response.status_code == 204
    assert "ytmm_refresh_token=" in response.headers["set-cookie"]
    assert client.cookies.get("ytmm_refresh_token") in (None, "")


def test_passwords_are_hashed_not_stored_in_clear(client: TestClient, db_session: Session):
    register(client)
    user = db_session.query(User).filter_by(email="kivic@example.com").one()
    assert user.password_hash is not None
    assert "hunter2pass" not in user.password_hash
    assert user.password_hash.startswith("$2b$")
