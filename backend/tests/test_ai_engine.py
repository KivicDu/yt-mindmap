import json
import logging

import pytest
from google.genai import errors as genai_errors

import ai_engine as ai_module
from ai_engine import (
    MAX_LOGGED_ERROR_CHARS,
    MAX_RETRIES,
    REQUEST_TIMEOUT,
    MindMapAI,
    _thinking_budget,
    describe_error,
    is_retryable,
)


def api_error(code: int, status: str) -> genai_errors.APIError:
    return genai_errors.APIError(code, {"error": {"status": status, "message": status}})


@pytest.fixture
def engine(monkeypatch):
    """An engine with a fake client, so no network call is ever made."""
    monkeypatch.setenv("GEMINI_API_KEY", "")
    instance = MindMapAI()
    assert instance.client is None
    instance.client = FakeClient()
    return instance


class FakeModels:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


class FakeClient:
    def __init__(self, outcomes=None):
        self.models = FakeModels(outcomes or [FakeResponse('{"new_nodes": []}')])


class FakeUsage:
    def __init__(self, prompt, output):
        self.prompt_token_count = prompt
        self.candidates_token_count = output
        self.total_token_count = prompt + output


class FakeResponse:
    def __init__(self, text, usage=None):
        self.text = text
        self.usage_metadata = usage


class TestRetryPolicy:
    def test_bad_credentials_are_not_retried(self):
        assert is_retryable(api_error(401, "UNAUTHENTICATED")) is False
        assert is_retryable(api_error(403, "PERMISSION_DENIED")) is False
        assert is_retryable(api_error(400, "INVALID_ARGUMENT")) is False
        assert is_retryable(api_error(404, "NOT_FOUND")) is False

    def test_rate_limits_and_server_errors_are_retried(self):
        assert is_retryable(api_error(429, "RESOURCE_EXHAUSTED")) is True
        assert is_retryable(api_error(500, "INTERNAL")) is True
        assert is_retryable(api_error(503, "UNAVAILABLE")) is True

    def test_network_errors_are_retried(self):
        assert is_retryable(TimeoutError("read timed out")) is True
        assert is_retryable(ConnectionError("connection reset")) is True

    def test_unknown_errors_fall_back_to_message_markers(self):
        assert is_retryable(Exception("API key not valid")) is False
        assert is_retryable(Exception("something odd happened")) is True


class TestThinkingBudget:
    def test_defaults_to_disabled_thinking(self, monkeypatch):
        monkeypatch.delenv("GEMINI_THINKING_BUDGET", raising=False)
        assert _thinking_budget() == 0

    def test_reads_env_override(self, monkeypatch):
        monkeypatch.setenv("GEMINI_THINKING_BUDGET", "512")
        assert _thinking_budget() == 512

    def test_invalid_and_negative_values_fall_back_to_zero(self, monkeypatch):
        monkeypatch.setenv("GEMINI_THINKING_BUDGET", "not-a-number")
        assert _thinking_budget() == 0
        monkeypatch.setenv("GEMINI_THINKING_BUDGET", "-9")
        assert _thinking_budget() == 0


class TestConfiguration:
    def test_missing_key_leaves_engine_unconfigured(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "")
        instance = MindMapAI()
        assert instance.configured is False
        assert instance.client is None

    def test_model_name_can_be_overridden(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "")
        monkeypatch.setenv("GEMINI_MODEL", "gemini-2.5-pro")
        assert MindMapAI().model_name == "gemini-2.5-pro"

    def test_blank_model_name_uses_default(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "")
        monkeypatch.setenv("GEMINI_MODEL", "   ")
        assert MindMapAI().model_name == ai_module.DEFAULT_MODEL

    def test_request_config_asks_for_json(self, engine):
        config = engine._config()
        assert config.response_mime_type == "application/json"
        assert config.temperature == 0.4

    def test_unconfigured_engine_returns_a_note_instead_of_calling_ai(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "")
        instance = MindMapAI()
        result = instance.generate_incremental_update(
            current_markdown="",
            transcript_chunk=[{"start": 1.0, "text": "hello"}],
            time_range=(1.0, 2.0),
        )
        assert result["note"] == "AI not configured"
        assert result["should_update"] is False


class TestGenerateIncrementalUpdate:
    def test_transient_failure_is_retried_with_backoff(self, engine, monkeypatch):
        sleeps = []
        monkeypatch.setattr(ai_module.time, "sleep", sleeps.append)
        engine.client = FakeClient(
            [
                api_error(503, "UNAVAILABLE"),
                api_error(429, "RESOURCE_EXHAUSTED"),
                FakeResponse(
                    json.dumps(
                        {
                            "should_update": True,
                            "new_nodes": [{"name": "Recursion", "time": 12.0}],
                            "summary": "recap",
                        }
                    )
                ),
            ]
        )

        result = engine.generate_incremental_update(
            current_markdown="",
            transcript_chunk=[{"start": 10.0, "text": "a recursive function calls itself"}],
            time_range=(10.0, 20.0),
        )

        assert result["should_update"] is True
        assert result["markdown_diff"] == "- [Recursion](#seek-12.0)"
        assert len(engine.client.models.calls) == MAX_RETRIES
        assert sleeps == [1.0, 2.0]

    def test_auth_error_fails_fast_without_sleeping(self, engine, monkeypatch):
        sleeps = []
        monkeypatch.setattr(ai_module.time, "sleep", sleeps.append)
        engine.client = FakeClient([api_error(401, "UNAUTHENTICATED")])

        result = engine.generate_incremental_update(
            current_markdown="",
            transcript_chunk=[{"start": 10.0, "text": "text"}],
            time_range=(10.0, 20.0),
        )

        assert "error" in result
        assert result["should_update"] is False
        assert len(engine.client.models.calls) == 1
        assert sleeps == []

    def test_empty_chunk_short_circuits_without_calling_ai(self, engine):
        result = engine.generate_incremental_update(
            current_markdown="# map",
            transcript_chunk=[],
            summary_so_far="kept",
        )
        assert result["summary"] == "kept"
        assert result["should_update"] is False
        assert engine.client.models.calls == []

    def test_prompt_carries_chunk_map_summary_and_time_range(self, engine):
        engine.generate_incremental_update(
            current_markdown="- [Old](#seek-1.0)",
            transcript_chunk=[{"start": 10.0, "text": "the new idea"}],
            summary_so_far="earlier summary",
            time_range=(10.0, 20.0),
        )
        sent = engine.client.models.calls[0]
        prompt = sent["contents"]
        assert sent["model"] == engine.model_name
        assert "[10.0s] the new idea" in prompt
        assert "- [Old](#seek-1.0)" in prompt
        assert "earlier summary" in prompt
        assert "NEW TRANSCRIPT SEGMENT (10.0s to 20.0s)" in prompt

    def test_long_chunk_is_truncated_before_sending(self, engine):
        huge = [{"start": float(i), "text": "x" * 200} for i in range(200)]
        engine.generate_incremental_update(
            current_markdown="", transcript_chunk=huge, time_range=(0.0, 200.0)
        )
        prompt = engine.client.models.calls[0]["contents"]
        assert "(segment truncated)" in prompt
        assert len(prompt) < ai_module.MAX_CHUNK_CHARS + 4000

    def test_long_map_context_keeps_the_tail_only(self, engine):
        long_map = "- [First](#seek-1.0)\n" + "- filler\n" * 1000 + "- [Newest](#seek-99.0)"
        engine.generate_incremental_update(
            current_markdown=long_map,
            transcript_chunk=[{"start": 100.0, "text": "next"}],
            time_range=(100.0, 110.0),
        )
        prompt = engine.client.models.calls[0]["contents"]
        assert "earlier parts omitted" in prompt
        assert "- [Newest](#seek-99.0)" in prompt
        assert "- [First](#seek-1.0)" not in prompt

    def test_malformed_ai_json_is_reported_not_raised(self, engine):
        engine.client = FakeClient([FakeResponse("this is not json")])
        result = engine.generate_incremental_update(
            current_markdown="",
            transcript_chunk=[{"start": 1.0, "text": "text"}],
            time_range=(1.0, 2.0),
        )
        assert "error" in result
        # The session keeps its old summary so the same chunk can be retried.
        assert result["summary"] == ""
        assert result["should_update"] is False


class TestTokenUsage:
    def test_usage_is_accumulated_across_calls(self, engine):
        payload = json.dumps({"should_update": False, "new_nodes": [], "summary": "s"})
        engine.client = FakeClient(
            [
                FakeResponse(payload, FakeUsage(100, 20)),
                FakeResponse(payload, FakeUsage(150, 30)),
            ]
        )
        for _ in range(2):
            engine.generate_incremental_update(
                current_markdown="",
                transcript_chunk=[{"start": 1.0, "text": "text"}],
                time_range=(1.0, 2.0),
            )
        assert engine.usage_totals == {"prompt": 250, "output": 50, "total": 300, "calls": 2}

    def test_missing_usage_metadata_is_ignored(self, engine):
        engine.client = FakeClient([FakeResponse('{"should_update": false}')])
        engine.generate_incremental_update(
            current_markdown="",
            transcript_chunk=[{"start": 1.0, "text": "text"}],
            time_range=(1.0, 2.0),
        )
        assert engine.usage_totals["calls"] == 0


class TestDescribeError:
    def test_keeps_the_class_name_and_the_provider_message(self):
        text = describe_error(api_error(429, "RESOURCE_EXHAUSTED"))
        assert text.startswith("APIError: ")
        assert "429" in text or "RESOURCE_EXHAUSTED" in text

    def test_collapses_multiline_messages_to_one_line(self):
        text = describe_error(ValueError("first line\n\n  second line\t"))
        assert text == "ValueError: first line second line"

    def test_caps_long_messages(self):
        text = describe_error(RuntimeError("x" * 5000))
        assert len(text) == len("RuntimeError: ") + MAX_LOGGED_ERROR_CHARS

    def test_handles_an_error_without_a_message(self):
        assert describe_error(RuntimeError()) == "RuntimeError"


class TestBaseUrl:
    def test_unset_by_default(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "")
        monkeypatch.delenv("GEMINI_BASE_URL", raising=False)
        assert MindMapAI().base_url == ""

    def test_is_passed_to_the_client_when_set(self, monkeypatch):
        captured = {}

        def fake_client(**kwargs):
            captured.update(kwargs)
            return object()

        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        monkeypatch.setenv("GEMINI_BASE_URL", "http://127.0.0.1:9090")
        monkeypatch.setattr(ai_module.genai, "Client", fake_client)

        instance = MindMapAI()

        assert instance.base_url == "http://127.0.0.1:9090"
        assert instance.configured is True
        assert captured["api_key"] == "test-key"
        assert captured["http_options"].base_url == "http://127.0.0.1:9090"
        assert captured["http_options"].timeout == REQUEST_TIMEOUT * 1000

    def test_blank_value_falls_back_to_the_sdk_default(self, monkeypatch):
        captured = {}

        def fake_client(**kwargs):
            captured.update(kwargs)
            return object()

        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        monkeypatch.setenv("GEMINI_BASE_URL", "   ")
        monkeypatch.setattr(ai_module.genai, "Client", fake_client)

        instance = MindMapAI()

        assert instance.base_url == ""
        assert captured["http_options"].base_url is None


class TestErrorLogging:
    def test_retry_warning_names_the_actual_cause(self, engine, monkeypatch, caplog):
        monkeypatch.setattr(ai_module.time, "sleep", lambda _seconds: None)
        engine.client = FakeClient(
            [api_error(429, "RESOURCE_EXHAUSTED"), FakeResponse('{"new_nodes": []}')]
        )

        with caplog.at_level(logging.WARNING, logger="ai_engine"):
            engine.generate_incremental_update(
                current_markdown="",
                transcript_chunk=[{"start": 1.0, "text": "hello"}],
                time_range=(1.0, 2.0),
            )

        messages = [record.getMessage() for record in caplog.records]
        assert any("RESOURCE_EXHAUSTED" in m and "retrying" in m for m in messages)

    def test_final_failure_is_logged_with_the_cause(self, engine, caplog):
        engine.client = FakeClient([api_error(401, "UNAUTHENTICATED")])

        with caplog.at_level(logging.WARNING, logger="ai_engine"):
            result = engine.generate_incremental_update(
                current_markdown="",
                transcript_chunk=[{"start": 1.0, "text": "hello"}],
                time_range=(1.0, 2.0),
            )

        assert result["should_update"] is False
        assert "error" in result
        messages = [record.getMessage() for record in caplog.records]
        assert any("Mind map update failed" in m and "UNAUTHENTICATED" in m for m in messages)

    def test_a_successful_call_logs_nothing(self, engine, caplog):
        with caplog.at_level(logging.WARNING, logger="ai_engine"):
            engine.generate_incremental_update(
                current_markdown="",
                transcript_chunk=[{"start": 1.0, "text": "hello"}],
                time_range=(1.0, 2.0),
            )
        assert [record for record in caplog.records if record.levelno >= logging.WARNING] == []
