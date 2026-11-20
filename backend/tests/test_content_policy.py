"""Layer-1 content gate: pure rules plus the /transcript integration path."""

import pytest
from fastapi.testclient import TestClient

import main as main_module
from app.core.config import Settings, get_settings
from app.services.content_policy import VideoMetadata, evaluate


def settings(**overrides) -> Settings:
    defaults = {
        "CONTENT_POLICY": "enforce",
        "CONTENT_ALLOW_CHANNELS": "",
        "CONTENT_ALLOW_VIDEO_IDS": "",
        "CONTENT_BLOCK_CHANNELS": "",
        "CONTENT_BLOCK_VIDEO_IDS": "",
        "CONTENT_MIN_DURATION_SECONDS": 180,
        "CONTENT_MIN_CUES": 20,
    }
    defaults.update(overrides)
    return Settings(**defaults)


def lecture_meta(**overrides) -> VideoMetadata:
    defaults = {
        "video_id": "abcdefghijk",
        "title": "Introduction to biology",
        "author_name": "Teacher",
        "oembed_checked": True,
        "cue_count": 120,
        "duration_seconds": 600.0,
    }
    defaults.update(overrides)
    return VideoMetadata(**defaults)


@pytest.fixture()
def enforced(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "CONTENT_POLICY", "enforce")
    for name in (
        "CONTENT_ALLOW_CHANNELS",
        "CONTENT_ALLOW_VIDEO_IDS",
        "CONTENT_BLOCK_CHANNELS",
        "CONTENT_BLOCK_VIDEO_IDS",
    ):
        monkeypatch.setattr(settings, name, "")
    yield


class _Response:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _OembedClient:
    status_code = 200
    payload = {}
    offline = False

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, _url, params=None):
        if self.offline:
            raise OSError("offline")
        return _Response(self.status_code, self.payload)


def fake_oembed(monkeypatch, *, title="A lecture", channel="Teacher", offline=False):
    class Client(_OembedClient):
        payload = {
            "title": title,
            "author_name": channel,
            "thumbnail_url": "https://img.example/thumb.jpg",
        }
        offline_flag = offline

        async def get(self, url, params=None):
            if self.offline_flag:
                raise OSError("offline")
            return await super().get(url, params)

    monkeypatch.setattr(main_module.httpx, "AsyncClient", Client)


def fake_captions(monkeypatch, cues=120):
    def fetch(_url, _lang=None):
        entries = [
            {"start": index * 2.0, "duration": 2.0, "text": f"cue {index}"} for index in range(cues)
        ]
        return entries, "en"

    monkeypatch.setattr(main_module, "fetch_transcript", fetch)


def test_policy_off_keeps_the_old_behaviour():
    decision = evaluate(lecture_meta(title="Official music video"), settings(CONTENT_POLICY="off"))
    assert decision.allowed is True
    assert decision.label == "unverified"


def test_blocklist_refuses_an_explicit_video_and_channel():
    by_id = evaluate(
        lecture_meta(video_id="BADVIDEOID1"),
        settings(CONTENT_BLOCK_VIDEO_IDS="badvideoid1"),
    )
    by_channel = evaluate(
        lecture_meta(author_name="Sensitive Channel"),
        settings(CONTENT_BLOCK_CHANNELS="nhay cam, sensitive channel"),
    )
    assert by_id.allowed is False and by_id.code == "video_blocked"
    assert by_channel.allowed is False and by_channel.code == "video_blocked"


def test_allowlist_is_closed_but_trusts_a_match():
    miss = evaluate(lecture_meta(author_name="Random"), settings(CONTENT_ALLOW_CHANNELS="Teacher"))
    hit = evaluate(
        lecture_meta(author_name="Giáo viên"),
        settings(CONTENT_ALLOW_CHANNELS="giao vien", CONTENT_MIN_CUES=9999),
    )
    assert miss.allowed is False and miss.code == "content_not_lecture"
    assert hit.allowed is True and hit.label == "lecture"


def test_missing_oembed_fails_open_but_never_claims_a_lecture():
    decision = evaluate(lecture_meta(oembed_checked=False), settings())
    assert decision.allowed is True
    assert decision.label == "unverified"
    assert decision.reason == "metadata_unavailable"


def test_music_title_is_refused_after_accent_folding():
    decision = evaluate(lecture_meta(title="Bài hát Ca Nhạc Official MV"), settings())
    assert decision.allowed is False
    assert decision.code == "content_not_lecture"
    assert decision.reason == "title_pattern"


def test_short_or_sparse_captions_are_refused():
    too_short = evaluate(lecture_meta(cue_count=8, duration_seconds=90.0), settings())
    assert too_short.allowed is False and too_short.code == "content_too_short"

    normal = evaluate(lecture_meta(cue_count=120, duration_seconds=600.0), settings())
    assert normal.allowed is True and normal.label == "lecture"


def test_preflight_skips_length_checks():
    decision = evaluate(
        lecture_meta(cue_count=0, duration_seconds=0.0), settings(), check_length=False
    )
    assert decision.allowed is True
    assert decision.label == "lecture"


def test_blocked_video_never_reaches_the_transcript_client(enforced, monkeypatch):
    def must_not_run(*args, **kwargs):
        raise AssertionError("captions must not be fetched for a blocked video")

    monkeypatch.setattr(main_module, "fetch_transcript", must_not_run)
    monkeypatch.setattr(get_settings(), "CONTENT_BLOCK_VIDEO_IDS", "abcdefghijk")
    fake_oembed(monkeypatch)

    response = TestClient(main_module.app).post(
        "/transcript", json={"url": "https://youtu.be/abcdefghijk"}
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "video_blocked"
    assert main_module.sessions == {}


def test_allowlist_miss_is_refused_before_any_fetch(enforced, monkeypatch):
    def must_not_run(*args, **kwargs):
        raise AssertionError("captions must not be fetched outside the allowlist")

    monkeypatch.setattr(main_module, "fetch_transcript", must_not_run)
    monkeypatch.setattr(get_settings(), "CONTENT_ALLOW_CHANNELS", "Teacher")
    fake_oembed(monkeypatch, channel="Unknown channel")

    response = TestClient(main_module.app).post(
        "/transcript", json={"url": "https://youtu.be/abcdefghijk"}
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "content_not_lecture"


def test_allowed_lecture_creates_a_labelled_session(enforced, monkeypatch):
    client = TestClient(main_module.app)
    fake_oembed(monkeypatch, channel="Teacher")
    fake_captions(monkeypatch)

    response = client.post("/transcript", json={"url": "https://youtu.be/abcdefghijk"})

    assert response.status_code == 200
    assert response.json()["content_label"] == "lecture"
    session = next(iter(main_module.sessions.values()))
    assert session["content_label"] == "lecture"


def test_short_video_is_refused_after_captions_are_read(enforced, monkeypatch):
    fake_oembed(monkeypatch)
    fake_captions(monkeypatch, cues=4)

    response = TestClient(main_module.app).post(
        "/transcript", json={"url": "https://youtu.be/abcdefghijk"}
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "content_too_short"
    assert main_module.sessions == {}


def test_oembed_outage_still_lets_the_learner_study(enforced, monkeypatch):
    fake_oembed(monkeypatch, offline=True)
    fake_captions(monkeypatch)

    response = TestClient(main_module.app).post(
        "/transcript", json={"url": "https://youtu.be/abcdefghijk"}
    )

    assert response.status_code == 200
    assert response.json()["content_label"] == "unverified"
