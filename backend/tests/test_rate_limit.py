"""Rate limits and daily AI quotas."""

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.middleware.rate_limit import is_ai_path, is_get_limited
from app.services.rate_limit import reset_rate_limits


@pytest.fixture(autouse=True)
def _fresh_limits():
    reset_rate_limits()
    yield
    reset_rate_limits()


def test_auth_requests_are_rate_limited_per_ip(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(get_settings(), "RATE_LIMIT_AUTH_PER_MINUTE", 2)

    first = client.post(
        "/api/auth/login", json={"email": "a@b.com", "password": "whatever1"}
    )
    second = client.post(
        "/api/auth/login", json={"email": "a@b.com", "password": "whatever1"}
    )
    third = client.post(
        "/api/auth/login", json={"email": "a@b.com", "password": "whatever1"}
    )

    # The first two reach the route (401 invalid credentials); the third never does.
    assert first.status_code == 401
    assert second.status_code == 401
    assert third.status_code == 429
    assert third.json()["detail"] == "rate_limited"
    assert int(third.headers["retry-after"]) >= 1


def test_ai_burst_limit_returns_429(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(get_settings(), "RATE_LIMIT_AI_PER_MINUTE", 1)

    first = client.post("/transcript", json={})
    second = client.post("/transcript", json={})

    # Body validation runs after the middleware, so the first call never reaches
    # the AI path but still counts as a hit.
    assert first.status_code != 429
    assert second.status_code == 429
    assert second.json()["detail"] == "rate_limited"


def test_anonymous_daily_quota_blocks_after_limit(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    settings = get_settings()
    monkeypatch.setattr(settings, "RATE_LIMIT_AI_PER_MINUTE", 100)
    monkeypatch.setattr(settings, "AI_DAILY_QUOTA_ANONYMOUS", 1)

    first = client.post("/update-map", json={})
    second = client.post("/update-map", json={})

    assert first.status_code != 429
    assert second.status_code == 429
    assert second.json()["detail"] == "ai_quota_exceeded"


def test_rate_limiting_can_be_disabled(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", False)
    monkeypatch.setattr(settings, "RATE_LIMIT_AUTH_PER_MINUTE", 1)

    for _ in range(3):
        response = client.post(
            "/api/auth/login", json={"email": "a@b.com", "password": "whatever1"}
        )
        assert response.status_code == 401


@pytest.mark.parametrize(
    "path",
    ["/transcript", "/update-map", "/session/abc123/restructure"],
)
def test_known_ai_paths_are_recognised(path):
    assert is_ai_path(path) is True


@pytest.mark.parametrize(
    "path",
    [
        "/session/abc123/node",
        "/session/abc123/merge",
        "/session/restructure",
        "/api/auth/login",
        "/healthz",
    ],
)
def test_other_paths_are_not_counted_as_ai(path):
    assert is_ai_path(path) is False


def test_restructure_shares_the_ai_burst_bucket(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(get_settings(), "RATE_LIMIT_AI_PER_MINUTE", 2)

    transcript = client.post("/transcript", json={})
    first = client.post("/session/sid/restructure", json={"map_layout": "spider"})
    second = client.post("/session/sid/restructure", json={"map_layout": "circle"})

    # Body validation runs after the middleware, so a missing session does not
    # stop the request from counting as an AI call.
    assert transcript.status_code != 429
    assert first.status_code != 429
    assert second.status_code == 429
    assert second.json()["detail"] == "rate_limited"


def test_restructure_consumes_the_daily_ai_quota(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    settings = get_settings()
    monkeypatch.setattr(settings, "RATE_LIMIT_AI_PER_MINUTE", 100)
    monkeypatch.setattr(settings, "AI_DAILY_QUOTA_ANONYMOUS", 1)

    first = client.post("/session/sid/restructure", json={"map_layout": "spider"})
    second = client.post("/session/sid/restructure", json={"map_layout": "circle"})

    assert first.status_code != 429
    assert second.status_code == 429
    assert second.json()["detail"] == "ai_quota_exceeded"


@pytest.mark.parametrize(
    "path",
    [
        "/video-info",
        "/transcript/languages",
        "/transcript/track",
        "/stream/session-123",
        "/api/share/meta",
        "/api/share/YTMM-ABC12345",
    ],
)
def test_expensive_get_paths_are_recognised(path):
    assert is_get_limited(path) is True


@pytest.mark.parametrize("path", ["/healthz", "/", "/api/auth/providers"])
def test_cheap_get_paths_are_not_counted(path):
    assert is_get_limited(path) is False


def test_share_lookups_are_rate_limited_per_ip(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(get_settings(), "RATE_LIMIT_GET_PER_MINUTE", 1)

    first = client.get("/api/share/meta?slug=not-a-real-slug")
    second = client.get("/api/share/meta?slug=not-a-real-slug")

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["detail"] == "rate_limited"
