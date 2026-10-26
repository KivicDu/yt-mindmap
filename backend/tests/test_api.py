from fastapi.testclient import TestClient

import main as main_module

client = TestClient(main_module.app)

SRT = """1
00:00:01,000 --> 00:00:02,000
First idea

2
00:00:03,000 --> 00:00:04,000
Second idea
"""

TRANSCRIPT = [
    {"start": 5.0, "duration": 5.0, "text": "intro"},
    {"start": 12.0, "duration": 3.0, "text": "core concept"},
]


def test_healthz_reports_runtime_state():
    response = client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["sessions"] == 0
    assert "ai_configured" in body


def test_transcript_from_uploaded_subtitles_creates_session():
    response = client.post(
        "/transcript",
        json={"url": "https://www.youtube.com/watch?v=abcdefghijk", "file_content": SRT},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["video_id"] == "abcdefghijk"
    assert body["cached"] is False
    assert len(body["transcript"]) == 2
    assert body["session_id"] in main_module.sessions


def test_transcript_requires_url_or_file():
    response = client.post("/transcript", json={})
    assert response.status_code == 400


def test_transcript_rejects_unparsable_subtitle_file():
    response = client.post(
        "/transcript",
        json={"url": "https://youtu.be/abcdefghijk", "file_content": "no cues here"},
    )
    assert response.status_code == 400


def test_update_map_without_session_reports_session_lost():
    response = client.post(
        "/update-map",
        json={"video_id": "vid", "last_time": 5, "session_id": "missing"},
    )
    body = response.json()
    assert response.status_code == 200
    assert body["session_lost"] is True
    assert body["should_update"] is False


def test_update_map_returns_disable_reasons():
    # Fresh session, playhead still before the first caption.
    session_id, _ = main_module.create_session("vid", TRANSCRIPT)
    body = client.post(
        "/update-map",
        json={"video_id": "vid", "last_time": 0, "session_id": session_id},
    ).json()
    assert body["reason"] == "no_new_chunk"
    assert body["consumed_until"] == 0.0

    # Pointer already past the playhead by a wide margin.
    main_module.sessions[session_id]["consumed_until"] = 100.0
    body = client.post(
        "/update-map",
        json={"video_id": "vid", "last_time": 10, "session_id": session_id},
    ).json()
    assert body["reason"] == "seek_backward"
    assert body["consumed_until"] == 100.0


def test_update_map_appends_diff_and_advances_pointer(monkeypatch):
    def fake_update(**kwargs):
        assert kwargs["transcript_chunk"] == TRANSCRIPT
        assert kwargs["time_range"] == (5.0, 15.0)
        return {
            "markdown_diff": "- [Core](#seek-5.0)",
            "new_nodes": [{"name": "Core", "time": 5}],
            "should_update": True,
            "summary": "compact",
        }

    monkeypatch.setattr(main_module.ai_engine, "generate_incremental_update", fake_update)

    session_id, _ = main_module.create_session("vid", TRANSCRIPT)
    body = client.post(
        "/update-map",
        json={"video_id": "vid", "last_time": 20, "session_id": session_id},
    ).json()

    assert body["should_update"] is True
    assert body["consumed_until"] == 15.0
    session = main_module.sessions[session_id]
    assert session["markdown"] == "- [Core](#seek-5.0)"
    assert session["summary_so_far"] == "compact"
    assert len(session["events"]) == 1

    # The diff is persisted to the per-video cache as well.
    assert main_module.video_cache["vid"]["markdown"] == "- [Core](#seek-5.0)"


def test_update_map_keeps_pointer_on_ai_failure(monkeypatch):
    monkeypatch.setattr(
        main_module.ai_engine,
        "generate_incremental_update",
        lambda **kwargs: {"error": "quota exceeded"},
    )

    session_id, _ = main_module.create_session("vid", TRANSCRIPT)
    body = client.post(
        "/update-map",
        json={"video_id": "vid", "last_time": 20, "session_id": session_id},
    ).json()

    assert body["reason"] == "ai_error"
    assert body["should_update"] is False
    # Retrying the same chunk later must be possible.
    assert body["consumed_until"] == 0.0
    assert main_module.sessions[session_id]["markdown"] == ""
