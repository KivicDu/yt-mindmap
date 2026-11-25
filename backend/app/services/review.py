"""Pure logic for ADR 0014 self-checks.

Everything that can be decided without a model is here: deterministic sampling,
answer normalisation, the first grading pass, and the opt-in review schedule.
The model is consulted only for an idea answer in the ambiguous band. Keeping
this module free of database and HTTP concerns makes those rules testable and
lets the client reuse the same arithmetic for `weak_ranges`.
"""

from __future__ import annotations

import hashlib
import math
import re
import secrets
import unicodedata
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from node_tree import clean_label, iter_nodes

DEFAULT_SAMPLE_SIZE = 12
MIN_TARGETS = 5
REVIEW_INTERVALS_DAYS = (1, 3, 7, 16)
CORRECT_THRESHOLD = 0.7
AMBIGUOUS_LOW = 0.4
MAX_WEAK_RANGES = 12
MAX_WEAK_SECONDS = 24 * 3600
MAX_CACHED_QUIZZES = 256

_DIGIT_WORDS = {
    "khong": "0",
    "mot": "1",
    "hai": "2",
    "ba": "3",
    "bon": "4",
    "nam": "5",
    "sau": "6",
    "bay": "7",
    "tam": "8",
    "chin": "9",
    "muoi": "10",
}
_NUMBER_RE = re.compile(r"\b(" + "|".join(sorted(_DIGIT_WORDS, key=len, reverse=True)) + r")\b")
_PUNCT_RE = re.compile(r"[^0-9a-z\s]+")
_STOPWORDS = frozenset(
    {
        "la",
        "cua",
        "va",
        "thi",
        "voi",
        "trong",
        "cai",
        "nhung",
        "ma",
        "de",
        "cho",
        "tren",
        "duoi",
        "ve",
        "co",
    }
)

# Idea questions are cached so reopening a check costs no model call. The key
# includes a fingerprint of the map, so editing the map invalidates the cache.
_quiz_cache: dict[str, dict[str, Any]] = {}
_quiz_by_map: dict[tuple[str, str], str] = {}


def normalize_answer(text: str) -> str:
    """Case/diacritic/punctuation-insensitive, with digits and words unified."""
    if not isinstance(text, str):
        return ""
    flat = unicodedata.normalize("NFKD", text.lower())
    flat = "".join(char for char in flat if not unicodedata.combining(char))
    # `đ` is its own Unicode letter, not a decorated `d`, so NFKD leaves it.
    flat = flat.replace("đ", "d")
    flat = _NUMBER_RE.sub(lambda match: _DIGIT_WORDS[match.group(0)], flat)
    flat = _PUNCT_RE.sub(" ", flat)
    return " ".join(token for token in flat.split() if token and token not in _STOPWORDS)


def answer_score(learner: str, expected: str) -> float:
    """How much of the expected idea the learner reproduced, 0.0–1.0.

    Containment is weighted more than precision: a short, correct answer should
    pass even when it omits words the map used as decoration.
    """
    said = set(normalize_answer(learner).split())
    key = set(normalize_answer(expected).split())
    if not said or not key:
        return 0.0
    common = said & key
    containment = len(common) / len(key)
    precision = len(common) / len(said)
    return round(0.7 * containment + 0.3 * precision, 3)


def grade_answer(learner: str, expected: str) -> tuple[str, float]:
    """Return ``(correct|incorrect|ambiguous, score)``.

    Only the ambiguous band is handed to the model; the extremes are decided
    locally so the same answer always scores the same way and most answers cost
    nothing.
    """
    score = answer_score(learner, expected)
    if score >= CORRECT_THRESHOLD:
        return "correct", score
    if score <= AMBIGUOUS_LOW:
        return "incorrect", score
    return "ambiguous", score


def grade_node_answer(
    learner: str, label: str, note: str = ""
) -> tuple[str, float, str]:
    """Grade against the canonical label, using the note only as support.

    The label is the node's answer (ADR 0003); a note is the learner's own extra
    context. Scoring both and taking the best match means an exact label always
    passes, even when a long note would otherwise dilute the overlap.
    """
    candidates = [part for part in (label, " ".join(part for part in (label, note) if part)) if part]
    if not candidates:
        return "incorrect", 0.0, ""
    best = ("incorrect", 0.0, candidates[0])
    for expected in candidates:
        verdict, score = grade_answer(learner, expected)
        if score > best[1]:
            best = (verdict, score, expected)
    return best


def sample_target_nodes(
    nodes: list[dict[str, Any]], attempt: int, count: int = DEFAULT_SAMPLE_SIZE
) -> list[dict[str, Any]]:
    """Deterministically sample labelled nodes, spread across the timeline.

    The same project and attempt always ask the same questions; a retry (a
    different ``attempt``) shifts the window. A map with fewer than
    ``MIN_TARGETS`` targets is rejected by the caller with a friendly message
    rather than a meaningless 2/2.
    """
    labelled = [node for node in iter_nodes(nodes) if clean_label(node.get("label"))]
    if not labelled:
        return []

    def sort_key(node: dict[str, Any]) -> tuple[float, str]:
        raw = node.get("time")
        time = float(raw) if isinstance(raw, (int, float)) and math.isfinite(raw) else math.inf
        return time, str(node.get("id") or "")

    ordered = sorted(labelled, key=sort_key)
    total = len(ordered)
    if total <= count:
        # Keep every node, but rotate the order so a retry is not identical.
        shift = attempt % total
        picked = ordered[shift:] + ordered[:shift]
    else:
        step = total / count
        offset = attempt % max(1, math.floor(step))
        indices = sorted({min(total - 1, math.floor(i * step) + offset) for i in range(count)})
        picked = [ordered[index] for index in indices]

    by_id = {str(node.get("id")): node for node in iter_nodes(nodes)}
    targets: list[dict[str, Any]] = []
    for node in picked:
        parent = by_id.get(str(node.get("parentId") or ""))
        raw_time = node.get("time")
        targets.append(
            {
                "id": str(node.get("id") or ""),
                "time": (
                    float(raw_time)
                    if isinstance(raw_time, (int, float)) and math.isfinite(raw_time)
                    else None
                ),
                "parent": (
                    clean_label(parent.get("label")) if parent is not None and parent.get("label") else ""
                ),
            }
        )
    return targets


def schedule_after_attempt(
    current_due: datetime | None, *, weak: bool, now: datetime | None = None
) -> datetime:
    """Advance one interval after a good check, step back one after a weak one.

    The step is derived from the current due date, so the only schedule state
    stored is ``projects.next_review_at`` (ADR 0014 §6).
    """
    moment = now or datetime.now(UTC)
    if current_due is None:
        step = 0
    else:
        due = current_due if current_due.tzinfo else current_due.replace(tzinfo=UTC)
        days_left = (due - moment).total_seconds() / 86400
        step = 0
        for index, interval in enumerate(REVIEW_INTERVALS_DAYS):
            if days_left <= interval:
                step = index
                break
        else:
            step = len(REVIEW_INTERVALS_DAYS) - 1

    step = max(0, step - 1) if weak else min(len(REVIEW_INTERVALS_DAYS) - 1, step + 1)
    return moment + timedelta(days=REVIEW_INTERVALS_DAYS[step])


def start_schedule(now: datetime | None = None) -> datetime:
    """First reminder is one day away; that is step 0 of the ladder."""
    moment = now or datetime.now(UTC)
    return moment + timedelta(days=REVIEW_INTERVALS_DAYS[0])


def clean_weak_ranges(raw: Any) -> list[list[float]]:
    """Validate the client-computed minute ranges before storing them."""
    if not isinstance(raw, list):
        return []
    cleaned: list[list[float]] = []
    for item in raw[:MAX_WEAK_RANGES]:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            continue
        try:
            start, end = float(item[0]), float(item[1])
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(start) and math.isfinite(end)):
            continue
        start = max(0.0, min(start, MAX_WEAK_SECONDS))
        end = max(0.0, min(end, MAX_WEAK_SECONDS))
        if start < end:
            cleaned.append([start, end])
    return sorted(cleaned, key=lambda pair: pair[0])


def quiz_cache_lookup(project_id: str, markdown: str) -> tuple[str, list[dict[str, str]]] | None:
    """Reuse a quiz while the map is unchanged."""
    key = (project_id, hashlib.sha256(markdown.encode("utf-8")).hexdigest())
    quiz_id = _quiz_by_map.get(key)
    if quiz_id is None:
        return None
    entry = _quiz_cache.get(quiz_id)
    if entry is None:
        _quiz_by_map.pop(key, None)
        return None
    return quiz_id, entry["questions"]


def quiz_cache_store(project_id: str, markdown: str, questions: list[dict[str, str]]) -> str:
    """Cache an answer key by an opaque id and return that id to the client."""
    quiz_id = secrets.token_urlsafe(18)
    if len(_quiz_cache) >= MAX_CACHED_QUIZZES:
        _quiz_cache.pop(next(iter(_quiz_cache)))
    _quiz_cache[quiz_id] = {"project_id": project_id, "questions": questions}
    key = (project_id, hashlib.sha256(markdown.encode("utf-8")).hexdigest())
    _quiz_by_map[key] = quiz_id
    return quiz_id


def quiz_for_attempt(quiz_id: str, project_id: str) -> list[dict[str, str]] | None:
    """Look up the answer key for a submitted attempt."""
    entry = _quiz_cache.get(quiz_id)
    if entry is None or entry["project_id"] != project_id:
        return None
    return entry["questions"]


def reset_quiz_cache() -> None:
    """Test helper: keep quiz keys from leaking between isolated test cases."""
    _quiz_cache.clear()
    _quiz_by_map.clear()


def collect_quiz(
    project_id: str,
    markdown: str,
    generate: Callable[[str], list[dict[str, str]]],
) -> tuple[str, list[dict[str, str]], bool]:
    """Return ``(quiz_id, questions, generated_now)``, caching the model call."""
    cached = quiz_cache_lookup(project_id, markdown)
    if cached is not None:
        return cached[0], cached[1], False
    questions = generate(markdown) or []
    return quiz_cache_store(project_id, markdown, questions), questions, True
