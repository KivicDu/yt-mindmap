"""ADR 0014 rules that never need a model or a database."""

from datetime import UTC, datetime, timedelta

from app.services import review as service


def nodes(count: int, *, with_times: bool = True) -> list[dict]:
    result = []
    for index in range(count):
        result.append(
            {
                "id": f"n{index}",
                "parentId": "n0" if index else None,
                "label": f"Ý {index}",
                "note": f"ghi chú bí mật {index}",
                "time": float(index * 60) if with_times else None,
                "children": [],
            }
        )
    return result


def test_normalize_answer_folds_diacritics_punctuation_and_digits():
    assert service.normalize_answer("  bốn!!  ") == "4"
    assert service.normalize_answer("  Hàm SỐ, bốn!!  ") == "ham so 4"
    assert service.normalize_answer("bốn") == service.normalize_answer("4")
    assert service.normalize_answer("Đường—cong") == service.normalize_answer("duong cong")


def test_grade_answer_decides_the_extremes_without_a_model():
    assert service.grade_answer("Hàm số", "Hàm số")[0] == "correct"
    assert service.grade_answer("hoàn toàn khác", "Hàm số")[0] == "incorrect"
    assert service.grade_answer("hàm số", "hàm số bậc hai")[0] == "ambiguous"


def test_grade_answer_is_deterministic():
    first = service.grade_answer("đạo hàm của hàm số", "Đạo hàm — hàm số")
    second = service.grade_answer("đạo hàm của hàm số", "Đạo hàm — hàm số")
    assert first == second


def test_sample_targets_are_deterministic_and_do_not_leak_the_key():
    first = service.sample_target_nodes(nodes(30), attempt=0)
    again = service.sample_target_nodes(nodes(30), attempt=0)

    assert first == again
    assert [target["id"] for target in first] == [target["id"] for target in again]
    assert len(first) == service.DEFAULT_SAMPLE_SIZE
    assert all("label" not in target and "note" not in target for target in first)
    assert all(target["parent"] == "Ý 0" for target in first[1:])
    assert first[0]["time"] == 0.0


def test_retry_changes_the_sampled_set():
    first = {item["id"] for item in service.sample_target_nodes(nodes(40), 0)}
    retry = {item["id"] for item in service.sample_target_nodes(nodes(40), 1)}
    assert first != retry


def test_short_maps_return_every_node_but_rotate_on_retry():
    short = nodes(4)
    assert len(service.sample_target_nodes(short, 0)) == 4
    assert [item["id"] for item in service.sample_target_nodes(short, 1)] == [
        "n1",
        "n2",
        "n3",
        "n0",
    ]


def test_review_ladder_advances_and_steps_back():
    now = datetime(2026, 11, 26, tzinfo=UTC)
    first = service.start_schedule(now)
    assert first - now == timedelta(days=1)

    second = service.schedule_after_attempt(first, weak=False, now=now)
    assert second - now == timedelta(days=3)
    third = service.schedule_after_attempt(second, weak=False, now=now)
    assert third - now == timedelta(days=7)
    fourth = service.schedule_after_attempt(third, weak=False, now=now)
    assert fourth - now == timedelta(days=16)
    # Cap at the top rung.
    assert service.schedule_after_attempt(fourth, weak=False, now=now) - now == timedelta(days=16)
    # A weak check steps back one rung, never before day one.
    assert service.schedule_after_attempt(third, weak=True, now=now) - now == timedelta(days=3)
    assert service.schedule_after_attempt(first, weak=True, now=now) - now == timedelta(days=1)


def test_weak_ranges_are_clamped_and_sorted():
    # A reversed pair is a client bug, so it is dropped rather than silently
    # swapped into a range the learner did not mean.
    raw = [[120, 60], ["bad", 90], [30, 75], [10, 40], [5, 10**9]]
    assert service.clean_weak_ranges(raw) == [
        [5.0, 86400.0],
        [10.0, 40.0],
        [30.0, 75.0],
    ]


def test_quiz_cache_reuses_keys_until_the_map_changes():
    service.reset_quiz_cache()
    generated = []

    def build(markdown: str):
        generated.append(markdown)
        return [{"id": "q1", "prompt": "?", "expected": "đáp án"}]

    first_id, questions, fresh = service.collect_quiz("p1", "- A", build)
    second_id, _, fresh_again = service.collect_quiz("p1", "- A", build)
    assert fresh is True and fresh_again is False
    assert first_id == second_id and len(generated) == 1

    third_id, _, fresh_changed = service.collect_quiz("p1", "- A\n- B", build)
    assert fresh_changed is True and third_id != first_id

    assert service.quiz_for_attempt(first_id, "p1") == questions
    assert service.quiz_for_attempt(first_id, "another-project") is None
    service.reset_quiz_cache()
