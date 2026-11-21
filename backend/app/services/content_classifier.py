"""Layer-2 content classifier, cached per video and caption sample.

One small AI call decides whether a video looks like study material. The call
costs quota, but the answer is stable for the same captions, so results are
cached in a bounded in-memory LRU. Failures fail open: an AI outage must never
stop a learner from opening a lecture.

The cache key is the video id plus a digest of the exact sample the AI reads,
so a replaced caption track gets a fresh decision while a replay is free.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
from collections import OrderedDict
from typing import Any

from ai_engine import MAX_CLASSIFY_CUES, ai_engine, classify_sample
from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

MAX_CACHE_ENTRIES = 200
_DECIDED_LABELS = frozenset({"lecture", "not_lecture", "sensitive"})

_CACHE: OrderedDict[str, dict[str, Any]] = OrderedDict()
_LOCK = threading.Lock()


def reset_classifier_cache() -> None:
    """Drop every cached decision (tests and operator use)."""
    with _LOCK:
        _CACHE.clear()


def _visual_digest(visuals: list[Any] | None) -> str:
    """Hash the exact images shown to the AI, so a changed frame re-decides.

    The source label is included: the same bytes at a different point in the
    video are a different signal. No images means an empty digest, which keeps
    the text-only cache key stable when the visual check is off.
    """
    if not visuals:
        return ""
    digest = hashlib.sha256()
    for visual in visuals:
        source = (
            visual.get("source")
            if isinstance(visual, dict)
            else getattr(visual, "source", "")
        )
        data = (
            visual.get("data")
            if isinstance(visual, dict)
            else getattr(visual, "data", b"")
        )
        digest.update(str(source).encode("utf-8"))
        digest.update(b"\x00")
        digest.update(bytes(data) if isinstance(data, (bytes, bytearray)) else b"")
        digest.update(b"\x00")
    return digest.hexdigest()[:24]


def _fingerprint(
    video_id: str, sample: list[dict[str, Any]], visual_digest: str = ""
) -> str:
    # ``schema`` invalidates decisions made before the visual signal existed.
    payload = json.dumps(
        {
            "schema": 2,
            "video_id": video_id,
            "sample": sample,
            "visuals": visual_digest,
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def classify(
    video_id: str,
    title: str | None,
    author: str | None,
    cues: list[dict[str, Any]],
    ai: Any = None,
    settings: Settings | None = None,
    visuals: list[Any] | None = None,
) -> dict[str, Any]:
    """Return ``{label, reason, confidence}`` for one video.

    ``ai`` and ``settings`` are injectable so tests never need a real key or a
    network call. Only positive decisions are cached; errors stay retryable.
    ``visuals`` is optional and off in production by default; when present it
    is part of both the AI call and the cache key.
    """
    cfg = settings or get_settings()
    if cfg.CONTENT_POLICY == "off" or not cfg.CONTENT_CLASSIFIER_ENABLED:
        return {"label": "unverified", "reason": "disabled", "confidence": 0.0}

    count = max(1, min(int(cfg.CONTENT_CLASSIFIER_CUES), MAX_CLASSIFY_CUES))
    sample = classify_sample(cues, count)
    if not sample:
        return {"label": "unverified", "reason": "no_cues", "confidence": 0.0}

    key = _fingerprint(video_id, sample, _visual_digest(visuals))
    with _LOCK:
        cached = _CACHE.get(key)
        if cached is not None:
            _CACHE.move_to_end(key)
            return dict(cached)

    engine = ai or ai_engine
    # Keep the 3-argument call for text-only engines (existing fakes/tests).
    if visuals:
        result = engine.classify_video(title, author, sample, visuals=visuals)
    else:
        result = engine.classify_video(title, author, sample)
    if result.get("label") in _DECIDED_LABELS:
        with _LOCK:
            _CACHE[key] = dict(result)
            _CACHE.move_to_end(key)
            while len(_CACHE) > MAX_CACHE_ENTRIES:
                _CACHE.popitem(last=False)
    else:
        logger.info("Classifier could not decide %s: %s", video_id, result.get("reason"))
    return result
