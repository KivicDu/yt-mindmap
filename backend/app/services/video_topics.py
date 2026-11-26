"""ADR 0016: label a search result with its study field.

YouTube's ``categoryId`` is too coarse ("Education", "Science & Technology")
and its author tags are noisy. A small fixed vocabulary over the text we
already have from Data API — the learner's query, title, channel and tags — is
enough to say "Toán học" or "Nấu ăn" without spending an AI call per result.
Nothing is returned as a percentage: a result either matches a field or is
labelled "Chưa xác định".
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.utils.text import normalize_search_text


@dataclass(frozen=True)
class TopicRule:
    code: str
    label: str
    keywords: tuple[str, ...]


# Ordered: the first rule wins an exact tie. Keep the vocabulary short and
# explicit so a new field is a one-line change with a deterministic outcome.
TOPIC_RULES = (
    TopicRule(
        "cong-nghe-thong-tin",
        "Công nghệ thông tin",
        (
            "lap trinh", "code", "python", "javascript", "react", "nodejs", "java",
            "c++", "sql", "csdl", "database", "thuat toan", "algorithm", "web",
            "ung dung", "phan mem", "software", "tri tue nhan tao",
            "artificial intelligence", "machine learning", "deep learning",
            "mang may tinh", "network", "devops", "linux", "git",
        ),
    ),
    TopicRule(
        "toan-hoc",
        "Toán học",
        (
            "toan", "toan hoc", "giai tich", "dao ham", "tich phan", "dai so",
            "hinh hoc", "xac suat", "thong ke", "phuong trinh", "math",
            "calculus", "algebra", "geometry", "statistics",
        ),
    ),
    TopicRule(
        "vat-li",
        "Vật lý",
        (
            "vat li", "luc", "dong hoc", "nhiet", "dao dong", "quang hoc",
            "dien tu", "physics", "quantum", "mechanics",
        ),
    ),
    TopicRule(
        "hoa-hoc",
        "Hóa học",
        (
            "hoa hoc", "phan ung", "nguyen tu", "phan tu", "dung dich",
            "acid", "base", "chemistry", "oxidation",
        ),
    ),
    TopicRule(
        "sinh-hoc",
        "Sinh học",
        (
            "sinh hoc", "te bao", "gen", "adn", "di truyen", "sinh thai",
            "biology", "cell", "evolution",
        ),
    ),
    TopicRule(
        "nau-an",
        "Nấu ăn",
        (
            "nau an", "cong thuc", "mon an", "lam banh", "bep", "recipe",
            "cooking", "chef", "baking",
        ),
    ),
    TopicRule(
        "ngon-ngu",
        "Ngôn ngữ",
        (
            "tieng anh", "tieng viet", "ngoai ngu", "ngu phap", "tu vung",
            "english", "grammar", "vocabulary", "language", "ielts", "toefl",
        ),
    ),
    TopicRule(
        "kinh-te",
        "Kinh tế",
        (
            "kinh te", "tai chinh", "dau tu", "chung khoan", "ke toan",
            "marketing", "economy", "finance", "accounting",
        ),
    ),
    TopicRule(
        "lich-su-dia-li",
        "Lịch sử · Địa lý",
        ("lich su", "dia li", "history", "geography"),
    ),
    TopicRule(
        "y-te",
        "Y tế",
        (
            "y hoc", "y te", "suc khoe", "benh", "thuoc", "giai phau",
            "anatomy", "health", "medical",
        ),
    ),
    TopicRule(
        "am-nhac-nghe-thuat",
        "Âm nhạc · Nghệ thuật",
        (
            "am nhac", "nhac ly", "guitar", "piano", "ve tranh", "thiet ke",
            "music theory", "drawing", "design",
        ),
    ),
)

UNKNOWN_CODE = "khac"
UNKNOWN_LABEL = "Chưa xác định"

# A result's own title and channel describe that video; the query only says
# what the learner was looking for and must not paint every result with the
# same field. Author tags are weakest: creators tag for reach, not accuracy.
_FIELD_WEIGHTS = (("title", 3), ("channel", 2), ("query", 2), ("tags", 1))

_PATTERNS = {
    rule.code: tuple(
        re.compile(r"(?<![a-z0-9])" + re.escape(keyword) + r"(?![a-z0-9])")
        for keyword in rule.keywords
    )
    for rule in TOPIC_RULES
}


def _hits(text: str, patterns: tuple[re.Pattern[str], ...]) -> int:
    if not text:
        return 0
    return sum(1 for pattern in patterns if pattern.search(text))


def classify(
    query: str,
    title: str | None = None,
    channel: str | None = None,
    tags: tuple[str, ...] | list[str] = (),
) -> dict[str, str]:
    """Return ``{code, label}`` for one search result.

    Pure and synchronous: no network, no AI and no database. Tests can assert
    the exact field for a fake result without any credentials.
    """
    fields = (
        normalize_search_text(title or ""),
        normalize_search_text(channel or ""),
        normalize_search_text(query),
        normalize_search_text(" ".join(tags)),
    )

    best_rule: TopicRule | None = None
    best_score = 0
    best_per_field: tuple[int, ...] = ()
    for rule in TOPIC_RULES:
        patterns = _PATTERNS[rule.code]
        per_field = tuple(_hits(field, patterns) for field in fields)
        score = sum(per_field[index] * weight for index, (_, weight) in enumerate(_FIELD_WEIGHTS))
        # Tuple order is title → channel → query → tags, so a tie prefers the
        # video's own words over the learner's search terms.
        if score > best_score or (score == best_score and per_field > best_per_field):
            best_rule, best_score, best_per_field = rule, score, per_field

    if best_rule is None or best_score == 0:
        return {"code": UNKNOWN_CODE, "label": UNKNOWN_LABEL}
    return {"code": best_rule.code, "label": best_rule.label}
