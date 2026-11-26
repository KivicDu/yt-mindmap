"""The learner's map language is independent of the caption track."""

from fastapi.testclient import TestClient

import main as main_module
from ai_engine import build_incremental_prompt, build_relabel_prompt

CUES = [
    {"start": 5.0, "duration": 5.0, "text": "intro"},
    {"start": 12.0, "duration": 3.0, "text": "core concept"},
]


def test_incremental_prompt_names_the_chosen_output_language():
    prompt = build_incremental_prompt(
        "tree", "", "", "hindi caption text", (0.0, 10.0), "vi"
    )
    assert "Vietnamese" in prompt
    assert 'code "vi"' in prompt
    assert "even when the transcript uses another language" in prompt
    assert "OUTPUT LANGUAGE" in prompt

    legacy = build_incremental_prompt("tree", "", "", "hindi", (0.0, 10.0))
    assert "Do not translate." in legacy


def test_relabel_prompt_asks_for_a_translated_summary():
    prompt = build_relabel_prompt("- [Root](#seek-1.0)", "en", "old summary")
    assert "English" in prompt
    assert "old summary" in prompt
    assert '"summary"' in prompt


def test_update_map_sends_the_output_language_to_the_ai(monkeypatch):
    seen = {}

    def fake_update(**kwargs):
        seen.update(kwargs)
        return {"new_nodes": [], "should_update": False, "summary": ""}

    monkeypatch.setattr(main_module.ai_engine, "generate_incremental_update", fake_update)
    session_id, _ = main_module.create_session("vid", CUES, output_language="vi")

    client = TestClient(main_module.app)
    client.post(
        "/update-map", json={"video_id": "vid", "last_time": 20, "session_id": session_id}
    )

    assert seen["output_language"] == "vi"


def test_switching_captions_keeps_the_chosen_map_language(monkeypatch):
    def fake_fetch(_url, lang=None):
        return ([{"start": 0.0, "duration": 2.0, "text": "hello" if lang == "en" else "नमस्ते"}], lang or "hi")

    monkeypatch.setattr(main_module, "fetch_transcript", fake_fetch)
    client = TestClient(main_module.app)
    created = client.post(
        "/transcript",
        json={"url": "https://youtu.be/abcdefghijk", "output_language": "vi"},
    ).json()
    session = main_module.sessions[created["session_id"]]
    session["nodes"] = [{"id": "n1", "parentId": None, "label": "Khái niệm", "time": 0.0}]
    session["markdown"] = "# Khái niệm"

    response = client.post(
        "/transcript", json={"session_id": created["session_id"], "language": "en"}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["language"] == "en"
    assert body["output_language"] == "vi"
    assert body["nodes"] == session["nodes"]
    assert session["output_language"] == "vi"


def test_changing_output_language_relabels_the_existing_map(monkeypatch):
    def fake_relabel(markdown, language, summary_so_far):
        assert "[Recursion](#seek-6.0)" in markdown
        assert language == "vi"
        assert summary_so_far == "old summary"
        return {
            "nodes": [{"name": "Đệ quy", "time": 6.0, "children": []}],
            "summary": "tóm tắt mới",
        }

    monkeypatch.setattr(main_module.ai_engine, "relabel", fake_relabel)
    session_id, _ = main_module.create_session(
        "vid",
        CUES,
        initial_nodes=[
            {
                "id": "node-1",
                "parentId": None,
                "label": "Recursion",
                "time": 6.0,
                "note": "ghi chú của tôi",
                "pinned": True,
                "children": [],
            }
        ],
        output_language="hi",
    )
    session = main_module.sessions[session_id]
    session["markdown"] = "- [Recursion](#seek-6.0)"
    session["summary_so_far"] = "old summary"

    client = TestClient(main_module.app)
    response = client.post(
        "/output-language", json={"session_id": session_id, "output_language": "vi"}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["translated"] is True
    assert body["output_language"] == "vi"
    node = session["nodes"][0]
    assert node["label"] == "Đệ quy"
    assert node["id"] == "node-1"
    assert node["time"] == 6.0
    assert node["note"] == "ghi chú của tôi"
    assert node["pinned"] is True
    assert session["summary_so_far"] == "tóm tắt mới"
    assert "Đệ quy" in session["markdown"]
    assert body["summary"] == "tóm tắt mới"


def test_failed_translation_keeps_the_old_language_and_map(monkeypatch):
    monkeypatch.setattr(
        main_module.ai_engine,
        "relabel",
        lambda markdown, language, summary: {"nodes": [], "summary": None, "error": "ai_unavailable"},
    )
    session_id, _ = main_module.create_session(
        "vid", CUES, initial_nodes=[{"id": "n1", "label": "Root", "children": []}], output_language="hi"
    )
    session = main_module.sessions[session_id]
    session["markdown"] = "- [Root](#seek-0.0)"

    client = TestClient(main_module.app)
    response = client.post(
        "/output-language", json={"session_id": session_id, "output_language": "vi"}
    )

    assert response.status_code == 502
    assert session["output_language"] == "hi"
    assert session["nodes"][0]["label"] == "Root"


def test_cached_map_keeps_its_own_language_instead_of_disappearing():
    main_module.video_cache["vid"] = {
        "nodes": [{"id": "n1", "label": "Hindi", "children": []}],
        "markdown": "- [Hindi](#seek-1.0)",
        "summary_so_far": "",
        "consumed_until": 12.0,
        "map_mode": "tree",
        "output_language": "hi",
        "updated_at": 0.0,
    }

    session_id, cached = main_module.create_session("vid", CUES, output_language="vi")

    assert cached is True
    assert main_module.sessions[session_id]["output_language"] == "hi"
    assert main_module.sessions[session_id]["nodes"][0]["label"] == "Hindi"


def test_saved_project_reopens_with_its_own_output_language(client: TestClient):
    registered = client.post(
        "/api/auth/register",
        json={"email": "learner@example.com", "password": "hunter2pass", "display_name": "Learner"},
    ).json()
    headers = {"Authorization": f"Bearer {registered['access_token']}"}
    created = client.post(
        "/api/projects",
        json={
            "title": "Lecture",
            "video_id": "abcdefghijk",
            "nodes": [],
            "transcript": CUES,
            "transcript_language": "hi",
            "output_language": "en",
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text

    response = client.post(
        "/transcript", json={"project_id": created.json()["id"]}, headers=headers
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["language"] == "hi"
    assert body["output_language"] == "en"
    session = main_module.sessions[body["session_id"]]
    assert session["output_language"] == "en"


def test_autosave_persists_the_chosen_output_language(client: TestClient):
    registered = client.post(
        "/api/auth/register",
        json={"email": "saver@example.com", "password": "hunter2pass", "display_name": "Saver"},
    ).json()
    headers = {"Authorization": f"Bearer {registered['access_token']}"}
    session_id, _ = main_module.create_session("vid", CUES, output_language="vi")

    response = client.post(
        "/api/projects/autosave", json={"session_id": session_id}, headers=headers
    )

    assert response.status_code == 200, response.text
    assert response.json()["output_language"] == "vi"


def test_language_code_is_validated():
    client = TestClient(main_module.app)
    response = client.post(
        "/transcript",
        json={"url": "https://youtu.be/abcdefghijk", "output_language": "vi; drop table"},
    )
    assert response.status_code == 422
