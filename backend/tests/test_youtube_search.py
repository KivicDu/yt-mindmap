import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

import main as main_module
from app.api.routes.youtube_search import get_youtube_search_service
from app.core.config import get_settings
from app.services.youtube_search import (
    SEARCH_URL,
    VIDEOS_URL,
    YouTubeSearchService,
    parse_iso_duration,
)

FAKE_KEY = "fake-key-that-must-never-appear"

SEARCH_PAGE = {
    "items": [
        {
            "id": {"videoId": "abc12345678"},
            "snippet": {
                "title": "Đạo hàm là gì - Toán học THPT",
                "channelTitle": "Toán học Việt",
                "thumbnails": {"medium": {"url": "https://img.example/abc.jpg"}},
            },
        },
        {
            "id": {"videoId": "def12345678"},
            "snippet": {
                "title": "React hooks trong 10 phút",
                "channelTitle": "Lập trình cùng Lan",
                "thumbnails": {"default": {"url": "https://img.example/def.jpg"}},
            },
        },
    ],
    "nextPageToken": "next-page",
}

DETAILS_PAGE = {
    "items": [
        {
            "id": "abc12345678",
            "snippet": {
                "title": "Đạo hàm là gì - Toán học THPT",
                "channelTitle": "Toán học Việt",
                "tags": ["dao ham", "toan hoc"],
            },
            "contentDetails": {"duration": "PT12M30S"},
        },
        {
            "id": "def12345678",
            "snippet": {
                "title": "React hooks trong 10 phút",
                "channelTitle": "Lập trình cùng Lan",
                "tags": ["react", "javascript"],
            },
            "contentDetails": {"duration": "PT2M"},
        },
    ]
}


class FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict:
        return self._payload


class FakeDataApiClient:
    def __init__(
        self,
        *,
        page: dict | None = None,
        details: dict | None = None,
        search_status: int = 200,
        search_error_reason: str = "",
    ) -> None:
        self.page = SEARCH_PAGE if page is None else page
        self.details = DETAILS_PAGE if details is None else details
        self.search_status = search_status
        self.search_error_reason = search_error_reason
        self.calls: list[tuple[str, dict]] = []

    async def get(self, url: str, params: dict) -> FakeResponse:
        self.calls.append((url, dict(params)))
        if url == SEARCH_URL:
            if self.search_status >= 400:
                return FakeResponse(
                    {"error": {"errors": [{"reason": self.search_error_reason}]}},
                    self.search_status,
                )
            return FakeResponse(self.page)
        assert url == VIDEOS_URL
        return FakeResponse(self.details)


@pytest.fixture()
def search_api(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """Enable search with a fake Data API client; never touch the real key."""
    settings = get_settings()
    monkeypatch.setattr(settings, "YOUTUBE_SEARCH_ENABLED", True)
    monkeypatch.setattr(settings, "YOUTUBE_DATA_API_KEY", SecretStr(FAKE_KEY))
    monkeypatch.setattr(settings, "CONTENT_POLICY", "enforce")

    def install(fake: FakeDataApiClient) -> None:
        service = YouTubeSearchService(settings, fake)
        main_module.app.dependency_overrides[get_youtube_search_service] = lambda: service

    yield install
    main_module.app.dependency_overrides.pop(get_youtube_search_service, None)


def test_search_is_unavailable_without_a_key(client: TestClient) -> None:
    response = client.get("/api/youtube/search", params={"q": "dao ham"})

    assert response.status_code == 200
    body = response.json()
    assert body["unavailable"] is True
    assert body["items"] == []
    assert "dán link" in body["message"]


def test_search_maps_topic_duration_and_fit(search_api, client: TestClient) -> None:
    fake = FakeDataApiClient()
    search_api(fake)

    response = client.get("/api/youtube/search", params={"q": "toan hoc"})

    assert response.status_code == 200
    body = response.json()
    assert body["unavailable"] is False
    assert body["next_page_token"] == "next-page"
    first, second = body["items"]
    assert first["url"] == "https://www.youtube.com/watch?v=abc12345678"
    assert first["duration_seconds"] == 750
    assert first["topic_label"] == "Toán học"
    assert first["fit"] == "likely"
    assert second["topic_label"] == "Công nghệ thông tin"
    assert second["fit"] == "unknown"
    assert "ngắn" in second["fit_reason"]
    assert FAKE_KEY not in response.text


def test_identical_query_is_served_from_cache(search_api, client: TestClient) -> None:
    fake = FakeDataApiClient()
    search_api(fake)

    for _ in range(2):
        assert client.get("/api/youtube/search", params={"q": "lap trinh"}).status_code == 200

    # One search.list + one videos.list total, not one pair per request.
    assert len(fake.calls) == 2


def test_process_quota_stops_further_searches(
    search_api, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "YOUTUBE_SEARCH_DAILY_UNITS", 101)
    fake = FakeDataApiClient()
    search_api(fake)

    first = client.get("/api/youtube/search", params={"q": "toan hoc"})
    second = client.get("/api/youtube/search", params={"q": "hoa hoc"})

    assert first.json()["unavailable"] is False
    assert second.json()["unavailable"] is True
    assert "hết hạn mức" in second.json()["message"]
    assert len(fake.calls) == 2


def test_blocklisted_channel_is_marked_blocked(
    search_api, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "CONTENT_POLICY", "enforce")
    monkeypatch.setattr(settings, "CONTENT_BLOCK_CHANNELS", "Toán học Việt")
    fake = FakeDataApiClient()
    search_api(fake)

    body = client.get("/api/youtube/search", params={"q": "toan hoc"}).json()

    assert body["items"][0]["fit"] == "blocked"
    assert body["items"][0]["fit_label"] == "Không phù hợp"


def test_google_quota_error_hides_the_key(search_api, client: TestClient) -> None:
    fake = FakeDataApiClient(search_status=403, search_error_reason="quotaExceeded")
    search_api(fake)

    response = client.get("/api/youtube/search", params={"q": "toan hoc"})
    body = response.json()

    assert body["unavailable"] is True
    assert "hết hạn mức" in body["message"]
    assert FAKE_KEY not in response.text
    assert len(fake.calls) == 1


def test_short_query_does_not_spend_quota(search_api, client: TestClient) -> None:
    fake = FakeDataApiClient()
    search_api(fake)

    body = client.get("/api/youtube/search", params={"q": "a"}).json()

    assert body["unavailable"] is True
    assert fake.calls == []


@pytest.mark.parametrize(
    ("value", "expected"),
    [("PT12M30S", 750), ("PT1H2M3S", 3723), ("PT45S", 45), ("garbage", None), (None, None)],
)
def test_iso_duration(value, expected) -> None:
    assert parse_iso_duration(value) == expected
