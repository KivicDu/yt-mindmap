"""ADR 0014 model paths, exercised only with a fake client."""

import pytest

import ai_engine as ai_module
from ai_engine import (
    MindMapAI,
    build_grade_prompt,
    build_quiz_prompt,
    parse_grade_payload,
    parse_quiz_payload,
)


class FakeResponse:
    def __init__(self, text):
        self.text = text
        self.usage_metadata = None


class FakeModels:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return FakeResponse(outcome)


@pytest.fixture
def engine(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    instance = MindMapAI()
    instance.models = FakeModels([])
    instance.client = None
    return instance


def set_outcomes(engine, *outcomes):
    engine.models.outcomes = list(outcomes)
    engine.client = type("Client", (), {"models": engine.models})()


def test_quiz_prompt_uses_only_the_map(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    prompt = build_quiz_prompt("- Hàm số\n  - Đạo hàm")
    assert "- Hàm số" in prompt and "Đạo hàm" in prompt
    assert "transcript" in prompt.lower()  # explicitly forbidden, not included
    assert '"questions"' in prompt


def test_parse_quiz_payload_bounds_and_validates():
    raw = """```json
    {"questions": [
      {"prompt": "Ý chính?", "expected": "Hàm số"},
      {"prompt": "", "expected": "bỏ qua"},
      {"prompt": "Câu hai?", "expected": "Đạo hàm"}
    ]}
    ```"""
    assert parse_quiz_payload(raw) == [
        {"id": "q1", "prompt": "Ý chính?", "expected": "Hàm số"},
        {"id": "q3", "prompt": "Câu hai?", "expected": "Đạo hàm"},
    ]
    assert parse_quiz_payload("không phải json") == []


def test_parse_grade_payload_accepts_yes_no_and_rejects_noise():
    assert parse_grade_payload('{"same": true}') is True
    assert parse_grade_payload('{"same": "no"}') is False
    assert parse_grade_payload('{"same": 1}') is None
    assert parse_grade_payload("noise") is None


def test_generate_quiz_uses_the_fake_client_and_degrades_cleanly(engine):
    set_outcomes(engine, '{"questions": [{"prompt": "?", "expected": "Hàm số"}]}')
    assert engine.generate_quiz("- Hàm số")["questions"][0]["expected"] == "Hàm số"

    set_outcomes(engine, RuntimeError("offline"))
    result = engine.generate_quiz("- Hàm số")
    assert result["questions"] == [] and result["error"] == "ai_unavailable"


def test_grade_idea_marks_only_the_ambiguous_band(engine):
    prompt = build_grade_prompt("Hàm số", "đây là hàm số")
    assert "Hàm số" in prompt and "đây là hàm số" in prompt

    set_outcomes(engine, '{"same": true}')
    assert engine.grade_idea("Hàm số", "đây là hàm số") is True
    # No client means "keep the deterministic mark", never a network attempt.
    engine.client = None
    assert engine.grade_idea("Hàm số", "đây là hàm số") is None


def test_offline_engine_never_builds_a_client(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    assert MindMapAI().client is None
    assert ai_module.ai_engine.__class__ is MindMapAI
