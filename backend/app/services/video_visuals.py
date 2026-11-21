"""Bounded visual samples for the content classifier.

Captions and titles cannot describe what a video *shows*: a normal-looking
title and a harmless transcript can sit on top of sensitive imagery. This
module samples a handful of small public JPEGs instead of downloading the video
-- the uploader's thumbnail, three auto-generated frames spread across the
timeline, and up to two storyboard sheets when the URL happens to resolve.

No call here is required for a video to be accepted. A failed download simply
means fewer images, and the classifier falls back to text. Every request and
every response is bounded so a hostile video id cannot turn this into a
bandwidth sink.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import httpx

THUMBNAIL_HOST = "https://i.ytimg.com"
DEFAULT_TIMEOUT = 5.0
DEFAULT_MAX_IMAGES = 6
MAX_ALLOWED_IMAGES = 8
DEFAULT_MAX_BYTES = 1_500_000
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
JPEG_MAGIC = b"\xff\xd8\xff"


@dataclass(frozen=True)
class VisualSample:
    """One downloaded image, tagged with where it came from."""

    source: str
    url: str
    data: bytes


def duration_from_cues(cues: list[dict[str, Any]]) -> float:
    """Best-effort duration from the captions we already fetched."""
    return max(
        (
            float(cue.get("start", 0.0)) + float(cue.get("duration", 0.0))
            for cue in cues
            if isinstance(cue, dict)
        ),
        default=0.0,
    )


def candidate_urls(
    video_id: str,
    duration: float = 0.0,
    limit: int = DEFAULT_MAX_IMAGES,
) -> list[tuple[str, str]]:
    """Return ``(source, url)`` candidates, most reliable first.

    The ``/vi/{id}/{1,2,3}.jpg`` frames are picked by YouTube at roughly 25%,
    50% and 75% of the video, so they cost nothing and need no signed URL.
    Storyboard sheets are best-effort: without the signature from the player
    response they often 404, which the fetcher treats as "no sample".
    """
    if not VIDEO_ID_RE.fullmatch(video_id or ""):
        return []

    base = f"{THUMBNAIL_HOST}/vi/{video_id}"
    candidates: list[tuple[str, str]] = [
        ("thumbnail", f"{base}/hqdefault.jpg"),
        ("auto:25%", f"{base}/1.jpg"),
        ("auto:50%", f"{base}/2.jpg"),
        ("auto:75%", f"{base}/3.jpg"),
    ]
    sheets = 2 if duration > 600 else 1
    for index in range(sheets):
        candidates.append(
            (
                f"storyboard:L1:M{index}",
                f"{THUMBNAIL_HOST}/sb/{video_id}/storyboard3_L1/M{index}.jpg",
            )
        )

    cap = max(1, min(int(limit), MAX_ALLOWED_IMAGES))
    return candidates[:cap]


def fetch_visuals(
    video_id: str,
    *,
    duration: float = 0.0,
    limit: int = DEFAULT_MAX_IMAGES,
    timeout: float = DEFAULT_TIMEOUT,
    max_bytes: int = DEFAULT_MAX_BYTES,
    client: Any = None,
) -> list[VisualSample]:
    """Download the candidates that resolve to a real, small JPEG.

    ``client`` is injectable so tests use a fake and never open a socket. A
    caller-supplied client is never closed; a client we create always is.
    """
    candidates = candidate_urls(video_id, duration, limit)
    if not candidates:
        return []

    own_client = client is None
    http = client if client is not None else httpx.Client(timeout=timeout)
    samples: list[VisualSample] = []
    try:
        for source, url in candidates:
            try:
                response = http.get(url)
            except Exception:
                continue
            status = getattr(response, "status_code", 0)
            content = getattr(response, "content", b"")
            if status != 200 or not content or len(content) > max_bytes:
                continue
            if not content.startswith(JPEG_MAGIC):
                continue  # an HTML error page, not an image
            samples.append(VisualSample(source=source, url=url, data=content))
    finally:
        if own_client:
            http.close()
    return samples
