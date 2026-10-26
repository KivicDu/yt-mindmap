import json

import main as main_module
from main import cache_video_map, create_session, load_video_cache

TRANSCRIPT = [{"start": 0.0, "duration": 1.0, "text": "hello"}]


def session_payload(**overrides):
    payload = {
        "markdown": "# Map\n- [Recursion](#seek-1.0)",
        "summary_so_far": "summary",
        "consumed_until": 42.0,
    }
    payload.update(overrides)
    return payload


def test_cache_is_written_to_disk_and_reloaded():
    cache_video_map("vid1", session_payload())

    stored = json.loads(main_module.CACHE_PATH.read_text(encoding="utf-8"))
    assert stored["vid1"]["markdown"] == "# Map\n- [Recursion](#seek-1.0)"
    assert stored["vid1"]["nodes"] == []
    assert stored["vid1"]["consumed_until"] == 42.0
    assert "updated_at" in stored["vid1"]

    main_module.video_cache.clear()
    load_video_cache()
    assert main_module.video_cache["vid1"]["summary_so_far"] == "summary"


def test_cache_is_capped_and_drops_the_oldest_video(monkeypatch):
    monkeypatch.setattr(main_module, "MAX_CACHED_VIDEOS", 3)
    for index in range(4):
        cache_video_map(f"vid{index}", session_payload(markdown=f"# {index}"))

    assert set(main_module.video_cache) == {"vid1", "vid2", "vid3"}


def test_no_video_id_means_no_cache_entry():
    cache_video_map(None, session_payload())
    assert main_module.video_cache == {}
    assert not main_module.CACHE_PATH.exists()


def test_cache_survives_corrupted_file():
    main_module.CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    main_module.CACHE_PATH.write_text("{not json", encoding="utf-8")
    load_video_cache()  # must not raise
    assert main_module.video_cache == {}


def test_session_restores_markdown_and_pointer_from_cache():
    main_module.video_cache["vid1"] = session_payload()

    session_id, cached = create_session("vid1", TRANSCRIPT)

    assert cached is True
    session = main_module.sessions[session_id]
    # The heading is presentation, the bullet is the map.
    assert session["markdown"] == "- [Recursion](#seek-1.0)"
    assert [n["label"] for n in session["nodes"]] == ["Recursion"]
    assert session["consumed_until"] == 42.0
    assert session["summary_so_far"] == "summary"


def test_explicit_resume_and_markdown_win_over_cache():
    main_module.video_cache["vid1"] = session_payload()

    session_id, _ = create_session(
        "vid1",
        TRANSCRIPT,
        initial_markdown="- [Restored](#seek-12.5)",
        resume_at=12.5,
    )

    session = main_module.sessions[session_id]
    assert session["markdown"] == "- [Restored](#seek-12.5)"
    assert session["consumed_until"] == 12.5


def test_fresh_video_starts_empty_and_uncached():
    session_id, cached = create_session("newvid", TRANSCRIPT)

    session = main_module.sessions[session_id]
    assert cached is False
    assert session["markdown"] == ""
    assert session["consumed_until"] == 0.0


def test_cached_tree_is_restored_with_its_ids():
    tree = [
        {
            "id": "keep-1",
            "parentId": None,
            "label": "Trees",
            "time": 10.0,
            "children": [
                {"id": "keep-2", "parentId": "keep-1", "label": "AVL", "time": 20.0, "children": []}
            ],
        }
    ]
    main_module.video_cache["vid1"] = session_payload(nodes=tree, markdown="- [Trees](#seek-10.0)")

    session_id, _ = create_session("vid1", TRANSCRIPT)

    session = main_module.sessions[session_id]
    assert session["nodes"][0]["id"] == "keep-1"
    assert session["nodes"][0]["children"][0]["id"] == "keep-2"
    assert session["nodes"][0]["children"][0]["parentId"] == "keep-1"


def test_cache_written_without_nodes_still_migrates_from_markdown():
    main_module.video_cache["legacy"] = {
        "markdown": "- [Old idea](#seek-4.0)",
        "summary_so_far": "",
        "consumed_until": 5.0,
    }

    session_id, cached = create_session("legacy", TRANSCRIPT)

    session = main_module.sessions[session_id]
    assert cached is True
    assert [n["label"] for n in session["nodes"]] == ["Old idea"]
    assert session["nodes"][0]["id"]


def test_explicit_nodes_win_over_cache():
    main_module.video_cache["vid1"] = session_payload()

    session_id, _ = create_session(
        "vid1",
        TRANSCRIPT,
        initial_nodes=[
            {"id": "client-id", "parentId": None, "label": "Client branch", "children": []}
        ],
    )

    session = main_module.sessions[session_id]
    assert [n["label"] for n in session["nodes"]] == ["Client branch"]
    assert session["nodes"][0]["id"] == "client-id"


def test_session_starts_with_an_empty_tree_for_a_new_video():
    session_id, _ = create_session("fresh", TRANSCRIPT)
    session = main_module.sessions[session_id]
    assert session["nodes"] == []
    assert session["markdown"] == ""
