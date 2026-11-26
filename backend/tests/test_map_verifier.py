"""ADR 0017: no mind-map node reaches the learner without caption support."""

import pytest
from fastapi.testclient import TestClient

import ai_engine as ai_module
import main as main_module
from app.core.config import get_settings
from app.services import map_verifier
from app.services.rate_limit import ai_quota
from node_tree import normalize_cached_nodes, normalize_nodes

CUES = [
    {"start": 5.0, "duration": 5.0, "text": "intro to the lesson"},
    {"start": 12.0, "duration": 3.0, "text": "core concept and why it matters"},
    {"start": 90.0, "duration": 3.0, "text": "completely different closing remarks"},
]


class FakeEngine:
    """Just enough ``configured`` to let the verifier ask for a repair."""

    def __init__(self, decisions):
        self.decisions = decisions
        self.calls = []

    def verify_nodes(self, items, language=None):
        self.calls.append({"items": items, "language": language})
        return {"decisions": self.decisions}


def test_nearby_cues_ignores_distant_captions_and_handles_asr():
    assert [cue["text"] for cue in map_verifier.nearby_cues(12.0, CUES)] == [
        "core concept and why it matters",
        "intro to the lesson",
    ]
    asr = [{"start": 12.0, "text": "core concept"}, {"start": 20.0, "text": "next idea"}]
    assert [cue["text"] for cue in map_verifier.nearby_cues(13.0, asr)] == [
        "core concept",
        "next idea",
    ]
    assert map_verifier.nearby_cues(300.0, CUES) == []


def test_grounding_is_deterministic_and_stores_evidence(monkeypatch):
    monkeypatch.setattr(ai_module.ai_engine, "client", None)
    raw = [{"name": "core concept", "time": 12.0}, {"name": "distant idea", "time": 300.0}]
    outcome = map_verifier.verify_and_repair(raw, CUES, use_model=False, default_time=5.0)

    assert outcome["stats"]["checked"] == 2
    assert outcome["stats"]["grounded"] == 1
    assert outcome["stats"]["dropped"] == 1
    assert outcome["stats"]["model_used"] is False
    assert outcome["nodes"][0]["evidence"][0]["start"] == 12.0


def test_unsupported_label_is_repaired_from_a_verbatim_quote(monkeypatch):
    fake = FakeEngine(
        {
            "0": {
                "label": "core concept matters",
                "quote": "core concept and why",
                "drop": False,
            }
        }
    )
    monkeypatch.setattr(ai_module.ai_engine, "client", object())
    monkeypatch.setattr(ai_module.ai_engine, "verify_nodes", fake.verify_nodes)

    outcome = map_verifier.verify_and_repair(
        [{"name": "quantum physics", "time": 12.0}],
        CUES,
        use_model=True,
        language="Tiếng Việt",
    )

    assert outcome["stats"]["repaired"] == 1
    assert outcome["stats"]["dropped"] == 0
    assert outcome["stats"]["model_used"] is True
    assert outcome["nodes"][0]["name"] == "core concept matters"
    assert outcome["nodes"][0]["evidence"][0]["text"].startswith("core concept")
    assert fake.calls[0]["language"] == "Tiếng Việt"
    assert fake.calls[0]["items"][0]["path"] == "0"


def test_hallucinated_quote_drops_the_node_and_its_children(monkeypatch):
    fake = FakeEngine(
        {"0": {"label": "made up idea", "quote": "never said this in class", "drop": False}}
    )
    monkeypatch.setattr(ai_module.ai_engine, "client", object())
    monkeypatch.setattr(ai_module.ai_engine, "verify_nodes", fake.verify_nodes)

    outcome = map_verifier.verify_and_repair(
        [{"name": "quantum physics", "time": 12.0, "children": [{"name": "child", "time": 12.0}]}],
        CUES,
        use_model=True,
    )

    assert outcome["nodes"] == []
    assert outcome["stats"]["dropped"] == 2


def test_without_a_model_the_deterministic_fallback_still_drops(monkeypatch):
    monkeypatch.setattr(ai_module.ai_engine, "client", None)
    outcome = map_verifier.verify_and_repair(
        [{"name": "quantum physics", "time": 12.0}], CUES, use_model=True
    )
    assert outcome["nodes"] == []
    assert outcome["stats"]["dropped"] == 1


def test_restructure_carries_evidence_by_timestamp():
    old = [{"label": "core concept", "time": 12.0, "evidence": [{"start": 12.0, "text": "core concept and why"}]}]
    new = [{"name": "Core idea", "time": 12.0}, {"name": "Other", "time": 90.0}]
    carried = map_verifier.carry_evidence(old, new)

    assert carried[0]["evidence"][0]["start"] == 12.0
    assert "evidence" not in carried[1]


def test_normalizers_keep_grounded_evidence():
    raw = [
        {
            "name": "Core",
            "time": 12.0,
            "evidence": [{"start": 12.0, "text": "core concept and why it matters"}],
        }
    ]
    node = normalize_nodes(raw)[0]
    assert node["evidence"][0]["text"].startswith("core concept")

    cached = normalize_cached_nodes([{**node, "children": []}])[0]
    assert cached["evidence"][0]["start"] == 12.0


def test_verify_payload_rejects_unusable_replies():
    assert ai_module.parse_verify_payload('{"items":[{"id":"0","label":"Core","quote":"core concept"}]}') == {
        "0": {"label": "Core", "quote": "core concept", "drop": False}
    }
    assert ai_module.parse_verify_payload("not json") == {}
    assert ai_module.build_verify_prompt(
        [{"path": "0", "label": "Core", "captions": [{"start": 1.0, "text": "core concept"}]}]
    ).count("verbatim caption words") == 1


def test_update_map_verifies_repairs_and_charges_the_extra_call(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    settings = get_settings()
    monkeypatch.setattr(settings, "MAP_GROUNDING_ENABLED", True)
    monkeypatch.setattr(settings, "MAP_VERIFY_MODEL_ENABLED", True)
    monkeypatch.setattr(ai_module.ai_engine, "client", object())

    def fake_generate(**kwargs):
        return {
            "markdown_diff": "- [core concept](#seek-12.0)\n- [quantum physics](#seek-12.0)",
            "new_nodes": [
                {"name": "core concept", "time": 12.0},
                {"name": "quantum physics", "time": 12.0},
            ],
            "should_update": True,
            "summary": "compact",
        }

    def fake_verify(items, language=None):
        return {
            "decisions": {
                "1": {"label": "core concept matters", "quote": "core concept and why", "drop": False}
            }
        }

    monkeypatch.setattr(main_module.ai_engine, "generate_incremental_update", fake_generate)
    monkeypatch.setattr(main_module.ai_engine, "verify_nodes", fake_verify)

    session_id, _ = main_module.create_session("vid", CUES)
    body = client.post(
        "/update-map",
        json={"video_id": "vid", "last_time": 20, "session_id": session_id},
    ).json()

    assert body["should_update"] is True
    assert body["verification"] == {
        "checked": 2,
        "grounded": 1,
        "repaired": 1,
        "dropped": 0,
        "model_used": True,
    }
    assert "quantum physics" not in body["diff"]["markdown_diff"]
    assert "core concept matters" in body["diff"]["markdown_diff"]
    nodes = main_module.sessions[session_id]["nodes"]
    assert nodes[1]["evidence"][0]["start"] == 12.0
    # One unit for generation (middleware) + one for the verifier (route).
    assert sum(count for _, count in ai_quota._counts.values()) == 2
