"""Stable node identity for the mind map.

The map used to be a single Markdown string, which meant a node *was* its text:
no stable identity, no per-node state, no safe editing, and nothing to anchor a
comment or a presence cursor to. This module makes a node tree the source of
truth; Markdown becomes a projection used for rendering and for reading maps
cached by older versions.

Everything here is pure (no FastAPI, no AI SDK) so the rules can be unit-tested.
"""

import copy
import re
import uuid
from collections.abc import Iterable
from typing import Any

SEEK_PREFIX = "#seek-"
MAX_LABEL_CHARS = 200

_MARKDOWN_LINE = re.compile(r"^(?P<indent>[ \t]*)[-*]\s+(?P<body>.*)$")
_SEEK_LINK = re.compile(r"^\[(?P<label>.*?)\]\(#seek-(?P<time>\d+(?:\.\d+)?)\)$")


def new_id() -> str:
    """Identifier for a node, generated when the AI or a user creates it."""
    return uuid.uuid4().hex


def clean_label(raw: Any) -> str:
    """Normalise a label so duplicate detection is not fooled by whitespace."""
    text = " ".join(str(raw or "").split())
    return text[:MAX_LABEL_CHARS]


def label_key(label: str) -> str:
    """Comparison key for "the AI already told us this" checks."""
    return clean_label(label).casefold()


def resolve_time(raw: Any, default: float | None = None) -> float | None:
    """Pick a node's timestamp, falling back to the chunk start."""
    if isinstance(raw, bool):  # bool is an int subclass; not a timestamp
        raw = None
    if isinstance(raw, (int, float)) and raw >= 0:
        return float(raw)
    if isinstance(default, (int, float)) and default >= 0:
        return float(default)
    return None


def markdown_label(label: str, time: float | None) -> str:
    """Render one label for markmap.

    A timestamped label becomes a `#seek-` link, which the frontend intercepts
    to move the video. Square brackets are replaced because they would end the
    link text early.
    """
    text = clean_label(label)
    if time is None:
        return text
    return f"[{text.replace('[', '(').replace(']', ')')}]({SEEK_PREFIX}{float(time):.1f})"


def make_node(label: str, time: float | None, parent_id: str | None) -> dict[str, Any]:
    return {
        "id": new_id(),
        "parentId": parent_id,
        "label": label,
        "time": time,
        "children": [],
    }


def normalize_nodes(
    raw_nodes: Iterable[Any],
    default_time: float | None = None,
    parent_id: str | None = None,
) -> list[dict[str, Any]]:
    """Turn AI output (`name`/`title` + `children`) into tree nodes with ids.

    Invalid entries are skipped rather than failing the whole update, because a
    single malformed node should not throw away an otherwise useful chunk.
    """
    nodes: list[dict[str, Any]] = []
    for raw in raw_nodes or []:
        if not isinstance(raw, dict):
            continue
        label = clean_label(raw.get("name") or raw.get("title") or raw.get("label"))
        if not label:
            continue
        node = make_node(label, resolve_time(raw.get("time"), default_time), parent_id)
        node["children"] = normalize_nodes(
            raw.get("children") or [], default_time, parent_id=node["id"]
        )
        nodes.append(node)
    return nodes


def _index_children(children: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {label_key(child["label"]): child for child in children}


def merge_nodes(
    tree: list[dict[str, Any]],
    incoming: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Add new branches to the tree, folding repeats into the existing node.

    The AI is instructed not to repeat itself, but it still does across chunk
    boundaries. Matching on the label inside the same parent keeps the map from
    growing duplicates while preserving every child that was added later.
    """
    merged = copy.deepcopy(tree)
    _merge_into(merged, incoming, parent_id=None)
    return merged


def _merge_into(
    target: list[dict[str, Any]],
    incoming: list[dict[str, Any]],
    parent_id: str | None,
) -> None:
    existing = _index_children(target)
    for node in incoming:
        key = label_key(node["label"])
        current = existing.get(key)
        if current is None:
            clone = copy.deepcopy(node)
            # The incoming node was built for a parent that may have been
            # folded away, so re-point it at the parent it actually lands under.
            clone["parentId"] = parent_id
            target.append(clone)
            existing[key] = clone
            continue
        # Same concept again: keep the original id and timestamp, but absorb
        # any children that were not seen before.
        _merge_into(
            current.setdefault("children", []),
            node.get("children") or [],
            parent_id=current["id"],
        )


def tree_to_markdown(
    nodes: Iterable[dict[str, Any]],
    depth: int = 0,
) -> str:
    """Project the tree onto markmap's Markdown format."""
    lines: list[str] = []
    for node in nodes or []:
        label = clean_label(node.get("label"))
        if not label:
            continue
        indent = "  " * depth
        lines.append(f"{indent}- {markdown_label(label, resolve_time(node.get('time')))}")
        children = node.get("children") or []
        if children:
            lines.append(tree_to_markdown(children, depth + 1))
    return "\n".join(line for line in lines if line)


def markdown_to_tree(markdown: str) -> list[dict[str, Any]]:
    """Rebuild a tree from Markdown, used for maps cached by older versions.

    Depth comes from indentation width (two spaces per level, four-space input
    is tolerated because integer division still lands on the right level).
    """
    roots: list[dict[str, Any]] = []
    stack: list[dict[str, Any]] = []

    for line in (markdown or "").splitlines():
        match = _MARKDOWN_LINE.match(line)
        if not match:
            continue
        body = match.group("body").strip()
        if not body:
            continue

        time: float | None = None
        seek = _SEEK_LINK.match(body)
        if seek:
            label = clean_label(seek.group("label"))
            time = float(seek.group("time"))
        else:
            label = clean_label(body)
        if not label:
            continue

        depth = len(match.group("indent").expandtabs(2)) // 2
        depth = min(depth, len(stack))
        stack = stack[:depth]
        parent_id = stack[-1]["id"] if stack else None

        node = make_node(label, time, parent_id)
        if stack:
            stack[-1]["children"].append(node)
        else:
            roots.append(node)
        stack.append(node)

    return roots


def iter_nodes(nodes: Iterable[dict[str, Any]]) -> Iterable[dict[str, Any]]:
    """Walk the tree in document order."""
    for node in nodes or []:
        yield node
        yield from iter_nodes(node.get("children") or [])


def count_nodes(nodes: Iterable[dict[str, Any]]) -> int:
    return sum(1 for _ in iter_nodes(nodes))


def find_node(nodes: Iterable[dict[str, Any]], node_id: str) -> dict[str, Any] | None:
    for node in iter_nodes(nodes):
        if node.get("id") == node_id:
            return node
    return None


def normalize_cached_nodes(raw: Any, parent_id: str | None = None) -> list[dict[str, Any]]:
    """Repair a tree loaded from the cache (missing ids, wrong shapes)."""
    if not isinstance(raw, list):
        return []
    nodes: list[dict[str, Any]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        label = clean_label(entry.get("label"))
        if not label:
            continue
        node_id = entry.get("id")
        node = {
            "id": node_id if isinstance(node_id, str) and node_id else new_id(),
            "parentId": parent_id,
            "label": label,
            "time": resolve_time(entry.get("time")),
            "children": [],
        }
        node["children"] = normalize_cached_nodes(entry.get("children"), parent_id=node["id"])
        nodes.append(node)
    return nodes
