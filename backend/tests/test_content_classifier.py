"""Layer-2 classifier: cache behaviour and the /transcript integration path."""

import pytest
from fastapi.testclient import TestClient
from test_content_policy import fake_captions, fake_oembed

import main as main_module
from app.core.config import get_settings
from app.services import content_classifier

VERDICT = {"label": "lecture", "reason": "structured teaching", "confidence": 0.9}


class FakeAI:
    """A stand-in for MindMapAI that records what the cache handed it."""

    def __init__(self, outcomes=None, refuse=False):
        self.outcomes = list(outcomes or [])
        self.calls = []
        self.refuse = refuse

    def classify_video(self, title, author, cues, visuals=None):
        if self.refuse:
            raise AssertionError("the classifier must not be called here")
        self.calls.append((title, author, cues))
        self.visuals = getattr(self, "visuals", []) + [visuals]
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def _settings(**overrides):
    from app.core.config import Settings

    defaults = {
        "CONTENT_POLICY": "enforce",
        "CONTENT_CLASSIFIER_ENABLED": True,
        "CONTENT_CLASSIFIER_CUES": 30,
    }
    defaults.update(overrides)
    return Settings(**defaults)


def _cues(count=40):
    return [{"start": float(i), "text": f"cue {i}"} for i in range(count)]


def _visual(source, data):
    return type("Visual", (), {"source": source, "data": data})()


class TestClassifierCache:
    def test_disabled_classifier_costs_no_ai_call(self):
        ai = FakeAI(refuse=True)
        result = content_classifier.classify(
            "abcdefghijk",
            "Title",
            "Channel",
            _cues(),
            ai,
            _settings(CONTENT_CLASSIFIER_ENABLED=False),
        )
        assert result["label"] == "unverified"
        assert result["reason"] == "disabled"

    def test_policy_off_also_skips_the_call(self):
        ai = FakeAI(refuse=True)
        result = content_classifier.classify(
            "abcdefghijk", "Title", "Channel", _cues(), ai, _settings(CONTENT_POLICY="off")
        )
        assert result["label"] == "unverified"

    def test_no_cues_is_unverified_without_a_call(self):
        ai = FakeAI(refuse=True)
        result = content_classifier.classify("abcdefghijk", "Title", "Channel", [], ai, _settings())
        assert result["reason"] == "no_cues"

    def test_same_video_and_sample_hits_the_cache(self):
        ai = FakeAI([VERDICT])
        cues = _cues()
        for _ in range(2):
            result = content_classifier.classify(
                "abcdefghijk", "Title", "Channel", cues, ai, _settings()
            )
        assert result["label"] == "lecture"
        assert len(ai.calls) == 1

    def test_a_changed_caption_sample_gets_a_new_decision(self):
        ai = FakeAI([VERDICT, {**VERDICT, "label": "not_lecture"}])
        content_classifier.classify("abcdefghijk", "Title", "Channel", _cues(), ai, _settings())
        result = content_classifier.classify(
            "abcdefghijk", "Title", "Channel", _cues(count=20), ai, _settings()
        )
        assert result["label"] == "not_lecture"
        assert len(ai.calls) == 2

    def test_a_different_video_does_not_share_the_decision(self):
        ai = FakeAI([VERDICT, {**VERDICT, "label": "sensitive"}])
        cues = _cues()
        content_classifier.classify("video-one", "Title", "Channel", cues, ai, _settings())
        result = content_classifier.classify("video-two", "Title", "Channel", cues, ai, _settings())
        assert result["label"] == "sensitive"
        assert len(ai.calls) == 2

    def test_failed_verdicts_are_not_cached(self):
        failure = {"label": "unverified", "reason": "ai_error", "confidence": 0.0}
        ai = FakeAI([failure, VERDICT])
        content_classifier.classify("abcdefghijk", "Title", "Channel", _cues(), ai, _settings())
        result = content_classifier.classify(
            "abcdefghijk", "Title", "Channel", _cues(), ai, _settings()
        )
        assert result["label"] == "lecture"
        assert len(ai.calls) == 2

    def test_text_only_call_does_not_pass_a_visuals_argument(self):
        ai = FakeAI([VERDICT])
        content_classifier.classify("abcdefghijk", "Title", "Channel", _cues(), ai, _settings())
        assert ai.visuals == [None]

    def test_same_images_hit_the_cache(self):
        ai = FakeAI([VERDICT])
        visuals = [_visual("thumbnail", b"\xff\xd8\xffone")]
        for _ in range(2):
            result = content_classifier.classify(
                "abcdefghijk", "Title", "Channel", _cues(), ai, _settings(), visuals=visuals
            )
        assert result["label"] == "lecture"
        assert len(ai.calls) == 1

    def test_changed_images_get_a_new_decision(self):
        ai = FakeAI([VERDICT, {**VERDICT, "label": "sensitive"}])
        first = [_visual("thumbnail", b"\xff\xd8\xffone")]
        second = [_visual("thumbnail", b"\xff\xd8\xfftwo")]
        content_classifier.classify(
            "abcdefghijk", "Title", "Channel", _cues(), ai, _settings(), visuals=first
        )
        result = content_classifier.classify(
            "abcdefghijk", "Title", "Channel", _cues(), ai, _settings(), visuals=second
        )
        assert result["label"] == "sensitive"
        assert len(ai.calls) == 2

    def test_source_label_is_part_of_the_image_cache_key(self):
        ai = FakeAI([VERDICT, {**VERDICT, "label": "not_lecture"}])
        data = b"\xff\xd8\xffsame"
        content_classifier.classify(
            "abcdefghijk",
            "Title",
            "Channel",
            _cues(),
            ai,
            _settings(),
            visuals=[_visual("thumbnail", data)],
        )
        result = content_classifier.classify(
            "abcdefghijk",
            "Title",
            "Channel",
            _cues(),
            ai,
            _settings(),
            visuals=[_visual("auto:50%", data)],
        )
        assert result["label"] == "not_lecture"
        assert len(ai.calls) == 2

    def test_cache_is_bounded(self, monkeypatch):
        monkeypatch.setattr(content_classifier, "MAX_CACHE_ENTRIES", 2)
        ai = FakeAI([VERDICT] * 3)
        for index in range(3):
            content_classifier.classify(
                f"video-{index}", "Title", "Channel", _cues(), ai, _settings()
            )
        assert len(content_classifier._CACHE) == 2


@pytest.fixture()
def classifier_on(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "CONTENT_POLICY", "enforce")
    monkeypatch.setattr(settings, "CONTENT_CLASSIFIER_ENABLED", True)
    monkeypatch.setattr(settings, "CONTENT_ALLOW_CHANNELS", "")
    monkeypatch.setattr(settings, "CONTENT_ALLOW_VIDEO_IDS", "")
    monkeypatch.setattr(settings, "CONTENT_BLOCK_CHANNELS", "")
    monkeypatch.setattr(settings, "CONTENT_BLOCK_VIDEO_IDS", "")
    content_classifier.reset_classifier_cache()
    fake_oembed(monkeypatch)
    fake_captions(monkeypatch)
    yield


def _post(url="https://youtu.be/abcdefghijk"):
    return TestClient(main_module.app).post("/transcript", json={"url": url})


def test_sensitive_video_is_refused_without_a_session(classifier_on, monkeypatch):
    monkeypatch.setattr(
        content_classifier,
        "ai_engine",
        FakeAI([{"label": "sensitive", "reason": "graphic", "confidence": 0.9}]),
    )

    response = _post()

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "content_sensitive"
    assert main_module.sessions == {}


def test_not_lecture_video_is_refused(classifier_on, monkeypatch):
    monkeypatch.setattr(
        content_classifier,
        "ai_engine",
        FakeAI([{"label": "not_lecture", "reason": "gameplay", "confidence": 0.8}]),
    )

    response = _post()

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "content_not_lecture"
    assert main_module.sessions == {}


def test_classifier_confirms_a_video_without_oembed(classifier_on, monkeypatch):
    fake_oembed(monkeypatch, offline=True)
    monkeypatch.setattr(content_classifier, "ai_engine", FakeAI([VERDICT]))

    response = _post()

    assert response.status_code == 200
    assert response.json()["content_label"] == "lecture"


def test_allowlisted_video_skips_the_classifier(classifier_on, monkeypatch):
    monkeypatch.setattr(get_settings(), "CONTENT_ALLOW_VIDEO_IDS", "abcdefghijk")
    monkeypatch.setattr(content_classifier, "ai_engine", FakeAI(refuse=True))

    response = _post()

    assert response.status_code == 200
    assert response.json()["content_label"] == "lecture"


def test_classifier_outage_fails_open(classifier_on, monkeypatch):
    monkeypatch.setattr(
        content_classifier,
        "ai_engine",
        FakeAI([{"label": "unverified", "reason": "ai_error", "confidence": 0.0}]),
    )

    response = _post()

    assert response.status_code == 200
    assert response.json()["content_label"] == "lecture"


def test_flag_on_feeds_images_to_the_classifier(classifier_on, monkeypatch):
    from app.services.video_visuals import VisualSample

    samples = [
        VisualSample(
            "thumbnail",
            "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
            b"\xff\xd8\xfffake",
        )
    ]
    fetches = []

    def fake_fetch(video_id, *, duration=0.0, **_kwargs):
        fetches.append((video_id, duration))
        return samples

    monkeypatch.setattr(main_module.video_visuals, "fetch_visuals", fake_fetch)
    monkeypatch.setattr(get_settings(), "CONTENT_VISUAL_CHECK_ENABLED", True)
    ai = FakeAI([VERDICT])
    monkeypatch.setattr(content_classifier, "ai_engine", ai)

    response = _post()

    assert response.status_code == 200
    assert fetches == [("abcdefghijk", 240.0)]
    assert ai.visuals == [samples]


def test_flag_off_never_fetches_or_sends_images(classifier_on, monkeypatch):
    def must_not_run(*_args, **_kwargs):
        raise AssertionError("visual fetch must be off by default")

    monkeypatch.setattr(main_module.video_visuals, "fetch_visuals", must_not_run)
    monkeypatch.setattr(get_settings(), "CONTENT_VISUAL_CHECK_ENABLED", False)
    ai = FakeAI([VERDICT])
    monkeypatch.setattr(content_classifier, "ai_engine", ai)

    response = _post()

    assert response.status_code == 200
    assert ai.visuals == [None]


def test_visual_fetch_failure_fails_open(classifier_on, monkeypatch):
    def broken_fetch(*_args, **_kwargs):
        raise OSError("network is down")

    monkeypatch.setattr(main_module.video_visuals, "fetch_visuals", broken_fetch)
    monkeypatch.setattr(get_settings(), "CONTENT_VISUAL_CHECK_ENABLED", True)
    ai = FakeAI([VERDICT])
    monkeypatch.setattr(content_classifier, "ai_engine", ai)

    response = _post()

    assert response.status_code == 200
    assert ai.visuals == [None]
