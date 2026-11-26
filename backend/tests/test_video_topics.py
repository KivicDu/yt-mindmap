"""ADR 0016: the study-field label is deterministic and never a score."""

from app.services.video_topics import UNKNOWN_CODE, classify


def test_the_videos_own_title_beats_the_search_query() -> None:
    # The learner searched for chemistry, but this result is a coding video.
    result = classify(
        "hoa hoc phan ung",
        title="React hooks cho người mới",
        channel="Lập trình cùng Lan",
        tags=["react", "javascript"],
    )

    assert result == {"code": "cong-nghe-thong-tin", "label": "Công nghệ thông tin"}


def test_query_breaks_a_tie_between_two_generic_results() -> None:
    result = classify(
        "bai giang hoa hoc",
        title="Bài giảng hay nhất",
        channel="Kênh giáo dục",
        tags=["bai giang"],
    )

    assert result["code"] == "hoa-hoc"


def test_title_and_channel_also_work_without_diacritics() -> None:
    assert classify("bai giang", title="Đạo hàm và tích phân", channel="Toán học Việt")[
        "code"
    ] == "toan-hoc"
    assert classify("video hay", title="Công thức bánh bông lan", channel="Bếp nhà tôi")[
        "code"
    ] == "nau-an"


def test_unmatched_results_are_labelled_unknown_without_a_percentage() -> None:
    result = classify("abcxyz", title="Video vui vẻ", channel="Kênh giải trí")

    assert result == {"code": UNKNOWN_CODE, "label": "Chưa xác định"}
    assert "%" not in str(result)
