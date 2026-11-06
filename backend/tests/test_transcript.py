import pytest
from fastapi.testclient import TestClient

import main as main_module
from transcript import TranscriptError, _select_transcript, extract_video_id

client = TestClient(main_module.app)


def test_extract_video_id_accepts_common_youtube_links():
    cases = [
        ("https://www.youtube.com/watch?v=abcdefghijk", "abcdefghijk"),
        ("https://youtu.be/abcdefghijk?t=42", "abcdefghijk"),
        ("youtube.com/shorts/abcdefghijk", "abcdefghijk"),
        ("https://youtube.com/live/abcdefghijk", "abcdefghijk"),
        ("https://www.youtube-nocookie.com/embed/abcdefghijk", "abcdefghijk"),
        ("https://m.youtube.com/watch?v=abcdefghijk&t=10", "abcdefghijk"),
        ("https://music.youtube.com/watch?v=abcdefghijk", "abcdefghijk"),
        ("https://www.youtube.com/v/abcdefghijk", "abcdefghijk"),
        ("https://www.youtube.com/watch?v=abcdefghijk", "abcdefghijk"),
        ("abcdefghijk", "abcdefghijk"),
    ]

    for url, expected in cases:
        assert extract_video_id(url) == expected


def test_extract_video_id_rejects_non_youtube_and_malformed_links():
    assert extract_video_id("https://example.com/watch?v=abcdefghijk") is None
    assert extract_video_id("https://youtube.com.evil.test/watch?v=abcdefghijk") is None
    assert extract_video_id("https://youtu.be/too-short") is None
    assert extract_video_id("") is None


class _FakeTranscript:
    def __init__(self, language_code: str, is_generated: bool):
        self.language_code = language_code
        self.is_generated = is_generated


class _FakeListing:
    def __init__(self, transcripts):
        self.video_id = "abcdefghijk"
        self._transcripts = transcripts

    def __iter__(self):
        return iter(self._transcripts)


def test_select_transcript_prefers_manual_then_original_generated():
    generated_vi = _FakeTranscript("vi", True)
    manual_en = _FakeTranscript("en", False)
    listing = _FakeListing([manual_en, generated_vi])

    # No preference: the manual track is the creator's own language.
    assert _select_transcript(listing, None) is manual_en


def test_select_transcript_uses_original_language_when_only_generated():
    generated_vi = _FakeTranscript("vi", True)
    listing = _FakeListing([generated_vi])

    # The Vietnamese auto track must win over a missing English one.
    assert _select_transcript(listing, "en") is generated_vi


def test_select_transcript_honours_an_explicit_language():
    manual_en = _FakeTranscript("en", False)
    generated_vi = _FakeTranscript("vi", True)
    listing = _FakeListing([manual_en, generated_vi])

    assert _select_transcript(listing, "vi") is generated_vi


def test_transcript_endpoint_returns_a_stable_error_code(monkeypatch):
    def fail(_url: str):
        raise TranscriptError("no_transcript", "No usable captions.", 422)

    monkeypatch.setattr(main_module, "fetch_transcript", fail)

    response = client.post(
        "/transcript", json={"url": "https://youtu.be/abcdefghijk"}
    )

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "no_transcript",
        "message": "No usable captions.",
    }


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


class _FakeAsyncClient:
    status_code = 200
    payload: dict = {}

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, _url, params=None):
        return _FakeResponse(self.status_code, self.payload)


def test_video_info_rejects_a_non_youtube_url():
    response = client.get("/video-info", params={"url": "https://example.com/x"})

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_url"


def test_video_info_reports_embeddable_video(monkeypatch):
    class EmbeddableClient(_FakeAsyncClient):
        status_code = 200
        payload = {
            "title": "A lecture",
            "author_name": "Teacher",
            "thumbnail_url": "https://img.example/thumb.jpg",
        }

    monkeypatch.setattr(main_module.httpx, "AsyncClient", EmbeddableClient)

    body = client.get(
        "/video-info", params={"url": "https://youtu.be/abcdefghijk"}
    ).json()

    assert body["video_id"] == "abcdefghijk"
    assert body["embeddable"] is True
    assert body["checked"] is True
    assert body["title"] == "A lecture"


@pytest.mark.parametrize("status_code", [400, 401, 403, 404])
def test_video_info_detects_blocked_embedding(monkeypatch, status_code):
    class BlockedClient(_FakeAsyncClient):
        pass

    BlockedClient.status_code = status_code

    monkeypatch.setattr(main_module.httpx, "AsyncClient", BlockedClient)

    body = client.get(
        "/video-info", params={"url": "https://youtu.be/abcdefghijk"}
    ).json()

    assert body["embeddable"] is False
    assert body["reason"] == "not_embeddable"
