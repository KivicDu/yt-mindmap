"""OAuth start/callback behaviour, with the provider network stubbed out."""

from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.routes import oauth as oauth_routes
from app.core.config import get_settings
from app.models.user import User
from app.services import oauth as oauth_service
from app.services.oauth import OAuthError, OAuthIdentity

GOOGLE_IDENTITY = OAuthIdentity(
    provider="google",
    provider_id="1234567890",
    email="Kivic@Example.com",
    display_name="Kivic",
    avatar_url="https://lh3.googleusercontent.com/a/photo",
)


@pytest.fixture()
def configured(monkeypatch: pytest.MonkeyPatch):
    """Configure Google only, and make sure GitHub stays empty."""
    settings = get_settings()
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "google-client-id")
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", "google-client-secret")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "")
    return settings


@pytest.fixture()
def unconfigured(monkeypatch: pytest.MonkeyPatch):
    """Blank every provider so the test ignores whatever `.env` holds."""
    settings = get_settings()
    for field in (
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GITHUB_CLIENT_ID",
        "GITHUB_CLIENT_SECRET",
    ):
        monkeypatch.setattr(settings, field, "")
    return settings


def cookie_value(response, name: str) -> str | None:
    for header in response.headers.get_list("set-cookie"):
        if header.lower().startswith(f"{name}=".lower()):
            return header.split(";", 1)[0].split("=", 1)[1]
    return None


def start_google(client: TestClient) -> str:
    """Hit the start route and return the state value it stored."""
    response = client.get("/api/auth/google", follow_redirects=False)
    state = cookie_value(response, "ytmm_oauth_state")
    assert state and state.startswith("google:")
    return state.split(":", 1)[1]


def test_unconfigured_provider_sends_the_browser_back_with_an_error(
    client: TestClient, unconfigured
):
    response = client.get("/api/auth/google", follow_redirects=False)
    assert response.status_code == 302
    location = response.headers["location"]
    assert location.startswith("http://localhost:5173/login?")
    assert "oauth=google" in location
    assert "error=oauth_not_configured" in location


def test_providers_endpoint_tells_the_frontend_what_is_enabled(client: TestClient, configured):
    assert client.get("/api/auth/providers").json() == {"google": True, "github": False}


def test_start_redirects_to_the_provider_with_a_state_cookie(client: TestClient, configured):
    response = client.get("/api/auth/google", follow_redirects=False)
    location = response.headers["location"]
    parsed = urlparse(location)
    query = parse_qs(parsed.query)

    assert parsed.netloc == "accounts.google.com"
    assert query["client_id"] == ["google-client-id"]
    assert query["response_type"] == ["code"]
    assert query["redirect_uri"] == ["http://localhost:8001/api/auth/google/callback"]
    assert query["state"][0]

    cookie_header = next(
        header
        for header in response.headers.get_list("set-cookie")
        if header.startswith("ytmm_oauth_state=")
    )
    assert "HttpOnly" in cookie_header
    assert "Path=/api/auth" in cookie_header


def test_callback_rejects_a_state_that_does_not_match_the_cookie(
    client: TestClient, configured
):
    start_google(client)
    response = client.get(
        "/api/auth/google/callback?code=abc&state=not-the-same",
        follow_redirects=False,
    )
    assert response.status_code == 302
    assert "error=oauth_state_mismatch" in response.headers["location"]


def test_callback_without_a_code_reports_the_reason(client: TestClient, configured):
    start_google(client)
    response = client.get("/api/auth/google/callback?state=x", follow_redirects=False)
    assert "error=oauth_callback_missing_code" in response.headers["location"]


def test_callback_reports_a_cancelled_consent_screen(client: TestClient, configured):
    start_google(client)
    response = client.get(
        "/api/auth/google/callback?error=access_denied&state=x",
        follow_redirects=False,
    )
    assert "error=oauth_denied" in response.headers["location"]


def test_callback_creates_the_user_and_opens_a_working_session(
    client: TestClient,
    configured,
    monkeypatch: pytest.MonkeyPatch,
    db_session: Session,
):
    state = start_google(client)
    monkeypatch.setattr(
        oauth_routes, "exchange_code", lambda provider, code: GOOGLE_IDENTITY
    )

    response = client.get(
        f"/api/auth/google/callback?code=good&state={state}", follow_redirects=False
    )
    assert response.status_code == 302
    assert response.headers["location"] == "http://localhost:5173/dashboard"
    assert cookie_value(response, "ytmm_refresh_token")
    assert cookie_value(response, "ytmm_session") == "1"

    user = db_session.query(User).filter_by(email="kivic@example.com").one()
    assert user.provider == "google"
    assert user.provider_id == "google:1234567890"
    assert user.password_hash is None
    assert user.email_verified is True
    assert user.avatar_url == GOOGLE_IDENTITY.avatar_url

    # The redirect put a refresh cookie in the jar, so the SPA can restore a
    # session without the user typing anything.
    refresh = client.post("/api/auth/refresh")
    assert refresh.status_code == 200
    me = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {refresh.json()['access_token']}"},
    )
    assert me.status_code == 200
    assert me.json()["display_name"] == "Kivic"


def test_signing_in_twice_reuses_the_same_account(
    client: TestClient, configured, monkeypatch: pytest.MonkeyPatch, db_session: Session
):
    monkeypatch.setattr(
        oauth_routes, "exchange_code", lambda provider, code: GOOGLE_IDENTITY
    )
    for _ in range(2):
        client.cookies.clear()
        state = start_google(client)
        client.get(
            f"/api/auth/google/callback?code=good&state={state}", follow_redirects=False
        )

    assert db_session.query(User).filter_by(email="kivic@example.com").count() == 1


def test_oauth_links_to_an_existing_password_account(
    client: TestClient, configured, monkeypatch: pytest.MonkeyPatch, db_session: Session
):
    # A password account already exists with the same email.
    client.post(
        "/api/auth/register",
        json={
            "email": "kivic@example.com",
            "password": "hunter2pass",
            "display_name": "Kivic",
        },
    )
    client.cookies.clear()

    state = start_google(client)
    monkeypatch.setattr(
        oauth_routes, "exchange_code", lambda provider, code: GOOGLE_IDENTITY
    )
    client.get(
        f"/api/auth/google/callback?code=good&state={state}", follow_redirects=False
    )

    user = db_session.query(User).filter_by(email="kivic@example.com").one()
    assert user.provider == "local"  # the password remains the primary method
    assert user.provider_id == "google:1234567890"
    assert user.password_hash is not None
    assert user.email_verified is True

    # Both sign-in methods keep working.
    assert client.post(
        "/api/auth/login",
        json={"email": "kivic@example.com", "password": "hunter2pass"},
    ).status_code == 200


def test_provider_failure_redirects_instead_of_returning_500(
    client: TestClient, configured, monkeypatch: pytest.MonkeyPatch
):
    state = start_google(client)

    def boom(provider: str, code: str):
        raise OAuthError("profile_fetch_failed", provider=provider)

    monkeypatch.setattr(oauth_routes, "exchange_code", boom)
    response = client.get(
        f"/api/auth/google/callback?code=good&state={state}", follow_redirects=False
    )
    assert response.status_code == 302
    assert "error=profile_fetch_failed" in response.headers["location"]


def test_github_profile_uses_a_verified_primary_email(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        oauth_service,
        "_post_form",
        lambda url, data: {"access_token": "gh-token"},
    )
    monkeypatch.setattr(oauth_service, "is_configured", lambda provider: True)

    def fake_get(url: str, token: str, headers=None):
        if url == oauth_service.GITHUB_USER_URL:
            return {"id": 42, "login": "kivic", "name": None, "email": None, "avatar_url": None}
        assert url == oauth_service.GITHUB_EMAILS_URL
        return [
            {"email": "old@example.com", "primary": False, "verified": True},
            {"email": "primary@example.com", "primary": True, "verified": True},
            {"email": "unverified@example.com", "primary": False, "verified": False},
        ]

    monkeypatch.setattr(oauth_service, "_get_json", fake_get)

    identity = oauth_service.exchange_code("github", "code")
    assert identity.email == "primary@example.com"
    assert identity.display_name == "kivic"
    assert identity.provider_id == "42"
    assert identity.email_verified is True


def test_github_without_a_verified_email_is_rejected(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        oauth_service, "_post_form", lambda url, data: {"access_token": "gh-token"}
    )
    monkeypatch.setattr(oauth_service, "is_configured", lambda provider: True)
    monkeypatch.setattr(
        oauth_service,
        "_get_json",
        lambda url, token, headers=None: {"id": 7, "login": "kivic", "email": None}
        if url == oauth_service.GITHUB_USER_URL
        else [],
    )

    with pytest.raises(OAuthError) as failure:
        oauth_service.exchange_code("github", "code")
    assert failure.value.code == "email_unavailable"


def test_token_exchange_failure_is_reported_as_an_oauth_error(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(oauth_service, "is_configured", lambda provider: True)

    def boom(url: str, data: dict):
        raise ValueError("not json")

    monkeypatch.setattr(oauth_service, "_post_form", boom)
    with pytest.raises(OAuthError) as failure:
        oauth_service.exchange_code("google", "code")
    assert failure.value.code == "token_exchange_failed"
