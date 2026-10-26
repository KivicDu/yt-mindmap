import json

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


LONG_TRANSCRIPT = [
    {"start": float(second), "duration": 4.0, "text": f"line at {second}s"}
    for second in range(0, 200, 5)
]


def _fake_ai(nodes, summary="compact"):
    return lambda **kwargs: {
        "markdown_diff": "x",
        "new_nodes": nodes,
        "should_update": True,
        "summary": summary,
    }


def test_update_map_returns_nodes_with_ids_and_parent_links(monkeypatch):
    monkeypatch.setattr(
        main_module.ai_engine,
        "generate_incremental_update",
        _fake_ai(
            [
                {
                    "name": "Trees",
                    "time": 6,
                    "children": [{"name": "AVL", "time": 9, "children": [{"name": "Rotations"}]}],
                }
            ]
        ),
    )
    session_id, _ = main_module.create_session("vid", TRANSCRIPT)

    body = client.post(
        "/update-map",
        json={"video_id": "vid", "last_time": 20, "session_id": session_id},
    ).json()

    trees = body["diff"]["nodes"]
    parent = trees[0]
    child = parent["children"][0]
    grandchild = child["children"][0]

    assert parent["parentId"] is None
    assert child["parentId"] == parent["id"]
    assert grandchild["parentId"] == child["id"]
    assert grandchild["label"] == "Rotations"
    # Nodes without a time fall back to the chunk start.
    assert grandchild["time"] == 5.0
    assert body["diff"]["markdown"] == (
        "- [Trees](#seek-6.0)\n  - [AVL](#seek-9.0)\n    - [Rotations](#seek-5.0)"
    )


def test_repeated_concepts_are_folded_across_updates(monkeypatch):
    monkeypatch.setattr(
        main_module.ai_engine,
        "generate_incremental_update",
        _fake_ai([{"name": "Recursion", "time": 6}]),
    )
    session_id, _ = main_module.create_session("vid", LONG_TRANSCRIPT)

    first = client.post(
        "/update-map", json={"video_id": "vid", "last_time": 20, "session_id": session_id}
    ).json()
    first_id = first["diff"]["nodes"][0]["id"]

    second = client.post(
        "/update-map", json={"video_id": "vid", "last_time": 40, "session_id": session_id}
    ).json()

    nodes = second["diff"]["nodes"]
    assert [n["label"] for n in nodes] == ["Recursion"]
    assert nodes[0]["id"] == first_id
    assert second["diff"]["markdown"] == "- [Recursion](#seek-6.0)"


def test_new_children_are_merged_into_an_existing_branch(monkeypatch):
    session_id, _ = main_module.create_session("vid", LONG_TRANSCRIPT)

    monkeypatch.setattr(
        main_module.ai_engine,
        "generate_incremental_update",
        _fake_ai([{"name": "Trees", "time": 6}]),
    )
    client.post("/update-map", json={"video_id": "vid", "last_time": 20, "session_id": session_id})

    monkeypatch.setattr(
        main_module.ai_engine,
        "generate_incremental_update",
        _fake_ai([{"name": "trees", "children": [{"name": "Balancing", "time": 30}]}]),
    )
    body = client.post(
        "/update-map", json={"video_id": "vid", "last_time": 40, "session_id": session_id}
    ).json()

    parent = body["diff"]["nodes"][0]
    assert parent["label"] == "Trees"
    assert [c["label"] for c in parent["children"]] == ["Balancing"]
    assert parent["children"][0]["parentId"] == parent["id"]


def test_transcript_response_includes_the_restored_tree():
    main_module.video_cache["abcdefghijk"] = {
        "nodes": [
            {"id": "a", "parentId": None, "label": "Cached", "time": 3.0, "children": []}
        ],
        "markdown": "- [Cached](#seek-3.0)",
        "summary_so_far": "",
        "consumed_until": 4.0,
    }
    response = client.post(
        "/transcript",
        json={"url": "https://youtu.be/abcdefghijk", "file_content": SRT},
    )
    body = response.json()
    assert body["nodes"][0]["id"] == "a"
    assert body["markdown"] == "- [Cached](#seek-3.0)"


def _session_with_nodes(nodes):
    session_id, _ = main_module.create_session("vid", TRANSCRIPT, initial_nodes=nodes)
    return session_id, main_module.sessions[session_id]


def _node(**overrides):
    node = {
        "id": "node-1",
        "parentId": None,
        "label": "Recursion",
        "time": 6.0,
        "note": "",
        "pinned": False,
        "children": [],
    }
    node.update(overrides)
    return node


def test_patch_node_renames_and_keeps_identity():
    session_id, session = _session_with_nodes([_node()])

    body = client.patch(
        "/node", json={"session_id": session_id, "node_id": "node-1", "label": " Đệ quy "}
    ).json()

    assert body["node"]["label"] == "Đệ quy"
    assert body["node"]["id"] == "node-1"
    assert body["node"]["time"] == 6.0
    assert body["nodes"][0]["label"] == "Đệ quy"
    assert body["markdown"] == "- [Đệ quy](#seek-6.0)"
    assert session["markdown"] == "- [Đệ quy](#seek-6.0)"


def test_patch_node_stores_a_note_and_pin():
    session_id, _ = _session_with_nodes([_node()])

    client.patch(
        "/node",
        json={"session_id": session_id, "node_id": "node-1", "note": "watch again", "pinned": True},
    )

    node = main_module.sessions[session_id]["nodes"][0]
    assert node["note"] == "watch again"
    assert node["pinned"] is True


def test_patch_node_can_clear_a_note_and_unpin():
    session_id, _ = _session_with_nodes([_node(note="old", pinned=True)])

    client.patch(
        "/node", json={"session_id": session_id, "node_id": "node-1", "note": "", "pinned": False}
    )

    node = main_module.sessions[session_id]["nodes"][0]
    assert node["note"] == ""
    assert node["pinned"] is False


def test_patch_node_only_applies_fields_that_were_sent():
    session_id, _ = _session_with_nodes([_node(note="keep me")])

    client.patch("/node", json={"session_id": session_id, "node_id": "node-1", "pinned": True})

    node = main_module.sessions[session_id]["nodes"][0]
    assert node["label"] == "Recursion"
    assert node["note"] == "keep me"
    assert node["pinned"] is True


def test_patch_node_rejects_an_empty_label():
    session_id, _ = _session_with_nodes([_node()])
    response = client.patch(
        "/node", json={"session_id": session_id, "node_id": "node-1", "label": "   "}
    )
    assert response.status_code == 400
    assert "label" in response.json()["detail"]


def test_patch_node_rejects_an_empty_body():
    session_id, _ = _session_with_nodes([_node()])
    response = client.patch("/node", json={"session_id": session_id, "node_id": "node-1"})
    assert response.status_code == 400


def test_patch_node_reports_a_missing_node():
    session_id, _ = _session_with_nodes([_node()])
    response = client.patch(
        "/node", json={"session_id": session_id, "node_id": "gone", "note": "x"}
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "node_not_found"


def test_patch_node_reports_a_lost_session():
    response = client.patch(
        "/node", json={"session_id": "nope", "node_id": "node-1", "note": "x"}
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "session_lost"


def test_patch_node_persists_to_the_cache():
    session_id, _ = _session_with_nodes([_node()])
    client.patch(
        "/node", json={"session_id": session_id, "node_id": "node-1", "note": "cached"}
    )

    stored = main_module.video_cache["vid"]
    assert stored["nodes"][0]["note"] == "cached"
    on_disk = json.loads(main_module.CACHE_PATH.read_text())
    assert on_disk["vid"]["nodes"][0]["note"] == "cached"


def test_patch_node_emits_an_event_for_other_tabs():
    session_id, session = _session_with_nodes([_node()])
    client.patch("/node", json={"session_id": session_id, "node_id": "node-1", "pinned": True})

    event = session["events"][-1]
    assert event["type"] == "node_edit"
    assert event["data"]["type"] == "node_edit"
    assert event["data"]["nodes"][0]["pinned"] is True


def test_edits_survive_the_next_ai_update(monkeypatch):
    session_id, _ = _session_with_nodes([_node()])
    client.patch(
        "/node",
        json={"session_id": session_id, "node_id": "node-1", "label": "Đệ quy", "note": "n", "pinned": True},
    )

    monkeypatch.setattr(
        main_module.ai_engine,
        "generate_incremental_update",
        _fake_ai([{"name": "Recursion", "children": [{"name": "Base case", "time": 30}]}]),
    )
    body = client.post(
        "/update-map", json={"video_id": "vid", "last_time": 40, "session_id": session_id}
    ).json()

    parent = body["diff"]["nodes"][0]
    assert len(body["diff"]["nodes"]) == 1
    assert parent["label"] == "Đệ quy"
    assert parent["note"] == "n"
    assert parent["pinned"] is True
    assert [c["label"] for c in parent["children"]] == ["Base case"]
