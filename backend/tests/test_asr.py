"""ADR 0012: the audio fallback is off, bounded and owner-only."""

import json
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from conftest import TestingSession
from fastapi.testclient import TestClient

import ai_engine as ai_module
import main as main_module
from app.core.config import get_settings
from app.services.rate_limit import asr_quota
from asr import ASRError, parse_cues, probe_duration, should_attempt_asr, transcribe
from transcript import TranscriptError

VIDEO_ID = "abcdefghijk"
URL = f"https://www.youtube.com/watch?v={VIDEO_ID}"


def register(client: TestClient, email: str) -> dict[str, str]:
    body = client.post(
        "/api/auth/register",
        json={"email": email, "password": "hunter2pass", "display_name": "Kivic"},
    ).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def enable_asr(monkeypatch: pytest.MonkeyPatch, *, duration: float = 600.0) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "ASR_ENABLED", True)
    monkeypatch.setattr(settings, "ASR_MAX_VIDEO_SECONDS", 10_800)
    monkeypatch.setattr(settings, "ASR_DAILY_LIMIT_PER_USER", 3)
    monkeypatch.setattr(main_module, "probe_duration", lambda _url: duration)

    async def fake_oembed(_video_id: str):
        return {
            "title": "Bài giảng giải tích",
            "author_name": "Khoa Toán",
            "thumbnail_url": None,
            "checked": True,
            "embeddable": True,
            "reason": None,
        }

    monkeypatch.setattr(main_module, "fetch_oembed", fake_oembed)
    monkeypatch.setattr(main_module, "SessionLocal", TestingSession)
    # A fake client is always present so tests never construct a real SDK client.
    monkeypatch.setattr(ai_module.ai_engine, "client", FakeGemini("[]"))


def caption_absence(monkeypatch: pytest.MonkeyPatch, code: str = "no_transcript") -> None:
    def fail(_url: str):
        raise TranscriptError(code, "No usable captions.", 422)

    monkeypatch.setattr(main_module, "fetch_transcript", fail)


class FakeDownloader:
    def __init__(self, workdir: Path, duration: float = 600.0) -> None:
        self.workdir = workdir
        self.duration = duration
        self.calls: list[bool] = []

    def extract_info(self, _url: str, *, download: bool):
        self.calls.append(download)
        if download:
            (self.workdir / "audio.mp3").write_bytes(b"fake audio")
            return {"duration": self.duration}
        return {"duration": self.duration}


class FakeGemini:
    def __init__(self, answer: str) -> None:
        self.uploaded: list[str] = []
        self.deleted: list[str] = []
        self.answer = answer
        self.files = SimpleNamespace(
            upload=self._upload,
            delete=self._delete,
        )
        self.models = SimpleNamespace(generate_content=self._generate)

    def _upload(self, *, file: str, config):
        self.uploaded.append(file)
        return SimpleNamespace(name="files/asr-1")

    def _delete(self, name: str) -> None:
        self.deleted.append(name)

    def _generate(self, *, model: str, contents, config):
        return SimpleNamespace(text=self.answer)


def test_only_caption_absence_codes_trigger_asr() -> None:
    assert should_attempt_asr("no_transcript")
    assert should_attempt_asr("transcripts_disabled")
    assert should_attempt_asr("empty_transcript")
    for code in (
        "age_restricted",
        "ip_blocked",
        "po_token_required",
        "video_blocked",
        "content_not_lecture",
        "video_unavailable",
    ):
        assert not should_attempt_asr(code)


def test_parse_cues_handles_json_timestamps_and_sentences() -> None:
    strict = '[{"start": 12.4, "text": "ý chính"}, {"start": 3, "text": "mở đầu"}]'
    assert parse_cues(strict) == [
        {"start": 3.0, "text": "mở đầu"},
        {"start": 12.4, "text": "ý chính"},
    ]
    stamped = "[00:03] mở đầu.\n[01:23.5] ý chính."
    assert parse_cues(stamped) == [
        {"start": 3.0, "text": "mở đầu."},
        {"start": 83.5, "text": "ý chính."},
    ]
    # A number at the start of a plain sentence is not a timestamp.
    sentences = parse_cues("2024 là năm. Đây là bài giảng.", duration=100)
    assert [cue["text"] for cue in sentences] == ["2024 là năm", "Đây là bài giảng"]
    assert sentences[-1]["start"] > sentences[0]["start"]
    assert parse_cues("") == []


def test_probe_duration_uses_the_metadata_path(tmp_path: Path) -> None:
    downloader = FakeDownloader(tmp_path, duration=3800)
    assert probe_duration(URL, downloader=downloader) == 3800
    assert downloader.calls == [False]


def test_transcribe_uploads_once_and_removes_audio(tmp_path: Path) -> None:
    answer = json.dumps([{"start": 10.0, "text": "ý chính"}])
    gemini = FakeGemini(answer)
    seen: dict[str, object] = {}

    def downloader(_url: str, *, download: bool):
        seen["download"] = download
        seen["path"] = tmp_path / ".keep"
        return {"duration": 42.0}

    # The downloader is the one place that writes the mp3, so emulate it with
    # a wrapper around the real temp directory chosen by transcribe().
    def fake_download_audio(_url, directory, *, bitrate, downloader=None):
        (directory / "audio.mp3").write_bytes(b"fake audio")
        return directory / "audio.mp3"

    import asr as asr_module

    original = asr_module._download_audio
    asr_module._download_audio = fake_download_audio  # type: ignore[assignment]
    try:
        cues, duration = transcribe(
            URL,
            client=gemini,
            duration=42.0,
            data_dir=tmp_path,
            downloader=downloader,
        )
    finally:
        asr_module._download_audio = original

    assert cues == [{"start": 10.0, "text": "ý chính"}]
    assert duration == 42.0
    assert len(gemini.uploaded) == 1
    assert gemini.deleted == ["files/asr-1"]
    assert not list((tmp_path / "asr").glob("job-*"))


def test_disabled_flag_keeps_the_old_caption_error(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    caption_absence(monkeypatch)
    response = client.post("/transcript", json={"url": URL})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "no_transcript"


def test_anonymous_visitor_is_asked_to_sign_in(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    enable_asr(monkeypatch)
    caption_absence(monkeypatch)
    response = client.post("/transcript", json={"url": URL})
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "asr_sign_in_required"


def test_quota_is_separate_from_the_ai_allowance(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    enable_asr(monkeypatch)
    caption_absence(monkeypatch)
    monkeypatch.setattr(ai_module.ai_engine, "client", FakeGemini("[]"))
    headers = register(client, "asr-quota@example.com")
    settings = get_settings()
    monkeypatch.setattr(settings, "ASR_DAILY_LIMIT_PER_USER", 1)

    first = client.post("/transcript", json={"url": URL}, headers=headers)
    assert first.status_code == 202, first.text
    assert first.json()["status"] == "asr_queued"
    second = client.post("/transcript", json={"url": URL}, headers=headers)
    assert second.status_code == 429
    assert second.json()["detail"]["code"] == "asr_quota_exceeded"
    keys = [key for key in asr_quota._counts if key.startswith("asr:user:")]
    assert len(keys) == 1
    assert asr_quota._counts[keys[0]][1] == 1


def test_too_long_video_is_refused_before_a_job(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    enable_asr(monkeypatch, duration=10_801)
    caption_absence(monkeypatch)
    headers = register(client, "asr-long@example.com")
    response = client.post("/transcript", json={"url": URL}, headers=headers)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "asr_too_long"


def test_job_is_owner_only_and_can_be_cancelled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    enable_asr(monkeypatch)
    caption_absence(monkeypatch)
    gate = {"open": False}

    def blocked_transcriber(set_stage, should_cancel, **_kwargs):
        while not gate["open"]:
            time.sleep(0.01)
        return [], None

    monkeypatch.setattr(main_module, "transcribe", blocked_transcriber)
    owner = register(client, "asr-owner@example.com")
    other = register(client, "asr-other@example.com")
    created = client.post("/transcript", json={"url": URL}, headers=owner)
    assert created.status_code == 202
    job_id = created.json()["job_id"]

    assert client.get(f"/transcript/asr/{job_id}", headers=other).status_code == 404
    assert client.delete(f"/transcript/asr/{job_id}", headers=other).status_code == 404
    assert client.delete(f"/transcript/asr/{job_id}", headers=owner).json() == {
        "status": "cancelled"
    }
    gate["open"] = True


def test_finished_job_reuses_the_normal_session_payload(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    enable_asr(monkeypatch)
    caption_absence(monkeypatch)
    monkeypatch.setattr(
        main_module,
        "transcribe",
        lambda set_stage, should_cancel, **_kwargs: (
            [{"start": 0.0, "text": "bài giảng"}],
            600.0,
        ),
    )
    headers = register(client, "asr-ready@example.com")
    created = client.post("/transcript", json={"url": URL}, headers=headers)
    assert created.status_code == 202
    job_id = created.json()["job_id"]

    payload = None
    for _ in range(200):
        response = client.get(f"/transcript/asr/{job_id}", headers=headers)
        payload = response.json()
        if payload["status"] in {"ready", "failed"}:
            break
        time.sleep(0.01)

    assert payload["status"] == "ready", payload
    assert payload["stage"] == "ready"
    session = payload["session"]
    assert session["transcript_source"] == "asr"
    assert session["session_id"]
    assert not payload.get("error")

    # A second learner gets the cached cues without starting another billable
    # job or consuming the daily quota.
    other = register(client, "asr-cached@example.com")
    reopened = client.post("/transcript", json={"url": URL}, headers=other)
    assert reopened.status_code == 200
    assert reopened.json()["transcript_source"] == "asr"
    # The second learner consumed no new ASR unit.
    assert len([key for key in asr_quota._counts if key.startswith("asr:user:")]) == 1


def test_failed_job_carries_a_stable_code(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    enable_asr(monkeypatch)
    caption_absence(monkeypatch)

    def fail(set_stage, should_cancel, **_kwargs):
        raise ASRError("asr_audio_blocked")

    monkeypatch.setattr(main_module, "transcribe", fail)
    headers = register(client, "asr-fail@example.com")
    job_id = client.post("/transcript", json={"url": URL}, headers=headers).json()["job_id"]
    payload = None
    for _ in range(200):
        payload = client.get(f"/transcript/asr/{job_id}", headers=headers).json()
        if payload["status"] in {"ready", "failed"}:
            break
        time.sleep(0.01)
    assert payload["status"] == "failed"
    assert payload["error"]["code"] == "asr_audio_blocked"
