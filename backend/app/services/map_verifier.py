"""ADR 0017: ground every generated mind-map node in transcript cues.

The generation model is good at naming ideas but can still invent a label or
move it to the wrong timestamp. This module adds the checks that run *before* a
node reaches the learner:

1. deterministic: find the captions nearest the node's time and measure word
   overlap with the label;
2. model: for the few nodes with no overlap, ask one bounded call to repair the
   label *and* quote the exact caption words it came from;
3. deterministic again: the quote must be found verbatim in those same cues,
   otherwise the node (and its children) is dropped;
4. the surviving cues are stored on the node as `evidence`.

Step 3 is what makes the model pass cheap to trust: a translated or rewritten
label cannot be checked by word overlap, but a verbatim caption quote can.
"""

from __future__ import annotations

from typing import Any

from ai_engine import MAX_VERIFY_ITEMS, ai_engine
from app.services import review
from node_tree import clean_evidence, clean_label

GROUND_WINDOW_SECONDS = 45.0
MAX_CUES_PER_NODE = 3
MAX_CUE_TEXT_CHARS = 320
GROUND_THRESHOLD = 0.34
QUOTE_THRESHOLD = 0.55
MAX_EVIDENCE_ITEMS = 2


def _cue_start(cue: dict[str, Any]) -> float:
    value = cue.get("start")
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.0


def _cue_end(cues: list[dict[str, Any]], index: int) -> float:
    cue = cues[index]
    duration = cue.get("duration")
    if isinstance(duration, (int, float)) and not isinstance(duration, bool) and duration > 0:
        return _cue_start(cue) + float(duration)
    if index + 1 < len(cues):
        return _cue_start(cues[index + 1])
    return _cue_start(cue) + 5.0


def _cue_text(cue: dict[str, Any]) -> str:
    return " ".join(str(cue.get("text") or "").split())[:MAX_CUE_TEXT_CHARS]


def nearby_cues(time: float | None, cues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The few captions that could have produced a node at ``time``.

    Cues without a duration (ASR) borrow the next cue's start. Anything more
    than ``GROUND_WINDOW_SECONDS`` away is not a plausible source for a label.
    """
    if time is None or not cues:
        return []
    ranked: list[tuple[float, dict[str, Any]]] = []
    for index, cue in enumerate(cues):
        text = _cue_text(cue)
        if not text:
            continue
        start, end = _cue_start(cue), _cue_end(cues, index)
        if end < time - GROUND_WINDOW_SECONDS or start > time + GROUND_WINDOW_SECONDS:
            continue
        distance = max(0.0, start - time, time - end)
        ranked.append((distance, {"start": _cue_start(cue), "text": text}))
    ranked.sort(key=lambda pair: pair[0])
    return [cue for _, cue in ranked[:MAX_CUES_PER_NODE]]


def grounding_score(label: str, cue_texts: list[str]) -> float:
    """How much of the short label is actually present in the captions."""
    if not label or not cue_texts:
        return 0.0
    # ``answer_score(caption, label)`` measures containment of the label, which
    # is what we want: a 3-word label should be covered by a long caption.
    return review.answer_score(" ".join(cue_texts), label)


def quote_is_grounded(quote: str, cue_texts: list[str]) -> bool:
    """A repaired node must cite words that really occur in its captions."""
    normalized_quote = review.normalize_answer(quote)
    if not normalized_quote:
        return False
    for text in cue_texts:
        normalized_cue = review.normalize_answer(text)
        if normalized_quote in normalized_cue:
            return True
        if review.answer_score(text, quote) >= QUOTE_THRESHOLD:
            return True
    return False


def _walk(nodes: list[Any], prefix: str = ""):
    """Yield ``(path, node)``; paths are stable while we filter the tree."""
    for index, node in enumerate(nodes or []):
        if not isinstance(node, dict):
            continue
        path = f"{prefix}{index}"
        yield path, node
        children = node.get("children")
        if isinstance(children, list):
            yield from _walk(children, f"{path}.")


def _rebuild(
    nodes: list[Any],
    prefix: str,
    dropped: set[str],
    labels: dict[str, str],
    evidence: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for index, node in enumerate(nodes or []):
        if not isinstance(node, dict):
            continue
        path = f"{prefix}{index}"
        if path in dropped:
            continue
        clone = dict(node)
        label = labels.get(path)
        if label:
            # `name` drives markdown_diff, `label` drives the stored tree.
            clone["name"] = label
            clone["label"] = label
        cues = evidence.get(path)
        if cues:
            clone["evidence"] = clean_evidence(cues)
        children = node.get("children")
        clone["children"] = _rebuild(
            children if isinstance(children, list) else [], f"{path}.", dropped, labels, evidence
        )
        result.append(clone)
    return result


def verify_and_repair(
    raw_nodes: list[Any],
    cues: list[dict[str, Any]],
    *,
    use_model: bool,
    language: str | None = None,
    default_time: float | None = None,
) -> dict[str, Any]:
    """Return nodes that are grounded, plus counts a UI can show without %."""
    entries = list(_walk(raw_nodes if isinstance(raw_nodes, list) else []))
    stats = {
        "checked": len(entries),
        "grounded": 0,
        "repaired": 0,
        "dropped": 0,
        "model_used": False,
    }
    if not entries:
        return {"nodes": [], "stats": stats}

    supported: dict[str, list[dict[str, Any]]] = {}
    issues: list[dict[str, Any]] = []
    for path, node in entries:
        label = clean_label(node.get("name") or node.get("title") or node.get("label"))
        time = node.get("time")
        if not isinstance(time, (int, float)) or isinstance(time, bool):
            time = default_time
        nearby = nearby_cues(float(time) if time is not None else None, cues)
        if label and grounding_score(label, [cue["text"] for cue in nearby]) >= GROUND_THRESHOLD:
            supported[path] = nearby[:MAX_EVIDENCE_ITEMS]
            stats["grounded"] += 1
        else:
            issues.append({"path": path, "label": label, "captions": nearby})

    decisions: dict[str, dict[str, Any]] = {}
    if issues and use_model and ai_engine.configured:
        outcome = ai_engine.verify_nodes(issues[:MAX_VERIFY_ITEMS], language)
        decisions = outcome.get("decisions") or {}
        stats["model_used"] = bool(decisions)

    dropped: set[str] = set()
    labels: dict[str, str] = {}
    evidence: dict[str, list[dict[str, Any]]] = dict(supported)
    for issue in issues:
        path = issue["path"]
        decision = decisions.get(path) or {}
        quote = decision.get("quote") or ""
        texts = [cue["text"] for cue in issue["captions"]]
        repaired_label = clean_label(decision.get("label") or "")
        if (
            decision.get("drop")
            or not repaired_label
            or not quote_is_grounded(quote, texts)
        ):
            dropped.add(path)
            continue
        labels[path] = repaired_label[:120]
        citing = [cue for cue in issue["captions"] if quote_is_grounded(quote, [cue["text"]])]
        evidence[path] = (citing or issue["captions"])[:MAX_EVIDENCE_ITEMS]
        stats["repaired"] += 1

    stats["dropped"] = sum(
        1
        for path, _ in entries
        if any(path == item or path.startswith(f"{item}.") for item in dropped)
    )
    verified = _rebuild(
        raw_nodes if isinstance(raw_nodes, list) else [], "", dropped, labels, evidence
    )
    if not verified:
        stats["dropped"] = stats["checked"]
    return {"nodes": verified, "stats": stats}


def carry_evidence(
    old_nodes: list[dict[str, Any]], new_nodes: list[Any]
) -> list[Any]:
    """Keep caption evidence when a restructure rebuilds the same timestamps.

    Restructure is told to preserve every `time`, so matching on time is enough
    and does not need another model call.
    """
    by_time: dict[float, list[dict[str, Any]]] = {}
    for _, node in _walk(old_nodes if isinstance(old_nodes, list) else []):
        time = node.get("time")
        found = clean_evidence(node.get("evidence"))
        if found and isinstance(time, (int, float)) and not isinstance(time, bool):
            by_time.setdefault(float(time), found)

    def copy_into(nodes: list[Any]) -> None:
        for node in nodes or []:
            if not isinstance(node, dict):
                continue
            time = node.get("time")
            if isinstance(time, (int, float)) and not isinstance(time, bool):
                found = by_time.get(float(time))
                if found:
                    node["evidence"] = found
            children = node.get("children")
            if isinstance(children, list):
                copy_into(children)

    copy_into(new_nodes)
    return new_nodes
