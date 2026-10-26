import json

import pytest

from ai_engine import MAX_SUMMARY_CHARS, parse_ai_payload


def test_plain_json_payload_is_normalised():
    raw = json.dumps(
        {
            "should_update": True,
            "new_nodes": [{"name": "Topic", "time": 3}],
            "summary": "short summary",
        }
    )
    result = parse_ai_payload(raw, summary_so_far="old", default_time=10.0)
    assert result["markdown_diff"] == "- [Topic](#seek-3.0)"
    assert result["should_update"] is True
    assert result["summary"] == "short summary"
    assert result["new_nodes"] == [{"name": "Topic", "time": 3}]


def test_fences_and_surrounding_prose_are_stripped():
    raw = (
        "Here is the result:\n"
        "```json\n"
        '{"should_update": true, "new_nodes": [{"name": "A"}], "summary": "s"}\n'
        "```\n"
        "Hope it helps!"
    )
    result = parse_ai_payload(raw, summary_so_far="", default_time=7.0)
    # Nodes without their own time fall back to the chunk start.
    assert result["markdown_diff"] == "- [A](#seek-7.0)"


def test_should_update_requires_actual_nodes():
    raw = json.dumps({"should_update": True, "new_nodes": [], "summary": "s"})
    assert parse_ai_payload(raw, summary_so_far="", default_time=0.0)["should_update"] is False


def test_should_update_false_is_respected():
    raw = json.dumps(
        {"should_update": False, "new_nodes": [{"name": "A", "time": 1}], "summary": "s"}
    )
    assert parse_ai_payload(raw, summary_so_far="", default_time=0.0)["should_update"] is False


def test_missing_summary_keeps_previous_one():
    raw = json.dumps({"should_update": False, "new_nodes": []})
    assert parse_ai_payload(raw, summary_so_far="previous", default_time=0.0)["summary"] == "previous"


def test_long_summary_is_truncated():
    raw = json.dumps({"should_update": False, "new_nodes": [], "summary": "x" * 5000})
    result = parse_ai_payload(raw, summary_so_far="", default_time=0.0)
    assert len(result["summary"]) == MAX_SUMMARY_CHARS


def test_non_list_nodes_are_ignored():
    raw = json.dumps({"should_update": True, "new_nodes": {"name": "oops"}, "summary": "s"})
    result = parse_ai_payload(raw, summary_so_far="", default_time=0.0)
    assert result["new_nodes"] == []
    assert result["should_update"] is False


def test_invalid_json_raises_for_caller_to_retry():
    with pytest.raises(json.JSONDecodeError):
        parse_ai_payload("not json at all", summary_so_far="", default_time=0.0)
