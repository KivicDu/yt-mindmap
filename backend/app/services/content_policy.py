"""Layer-1 content gate: decide whether a YouTube link is study material.

YouTube's oEmbed endpoint returns a title and a channel, but no category or
duration without a Data API key. This gate therefore uses what the app already
has: oEmbed metadata plus the caption cues it has just fetched. It is a policy
filter, not a classifier — it blocks obvious cases and labels the rest.

Rules, in order:

1. a blocklist always wins;
2. a non-empty allowlist is closed — anything outside it is refused;
3. without oEmbed metadata the gate cannot judge, so it allows and labels the
   video ``unverified`` (a network failure must not lock a learner out);
4. an explicit allowlist match is trusted, so duration and title checks are
   skipped for it;
5. otherwise a tight title heuristic and a minimum length decide.

No network call and no database access happens here; the caller supplies the
metadata it already obtained.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import Settings, get_settings
from app.utils.text import normalize_search_text

# Phrases that are strong signals of non-lecture content. Deliberately short:
# a loose list would reject a music-theory or film-studies lecture.
NON_LECTURE_PATTERNS = (
    "official music video",
    "official mv",
    "music video",
    "mv chinh thuc",
    "video ca nhac",
    "ca nhac",
    "full album",
    "gameplay",
    "playthrough",
    "let s play",
    "reaction",
    "react to",
    "stand up comedy",
    "standup comedy",
    "asmr",
    "trailer",
    "teaser",
)


@dataclass(frozen=True)
class VideoMetadata:
    """What the gate needs, already collected by the caller."""

    video_id: str
    title: str | None = None
    author_name: str | None = None
    oembed_checked: bool = False
    cue_count: int = 0
    duration_seconds: float = 0.0


@dataclass(frozen=True)
class Decision:
    allowed: bool
    code: str | None = None
    label: str = "unverified"  # "lecture" | "unverified"
    reason: str | None = None


def _csv_list(value: str) -> frozenset[str]:
    return frozenset(item.strip().lower() for item in value.split(",") if item.strip())


def _channel_list(value: str) -> frozenset[str]:
    return frozenset(normalize_search_text(item) for item in value.split(",") if item.strip())


def evaluate(
    meta: VideoMetadata,
    settings: Settings | None = None,
    *,
    check_length: bool = True,
) -> Decision:
    """Return the allow/deny decision for one video.

    ``check_length=False`` is the pre-flight call made before captions are
    fetched: it applies the blocklist, allowlist and title rules but cannot
    judge duration or cue count yet.
    """

    cfg = settings or get_settings()
    if cfg.CONTENT_POLICY == "off":
        return Decision(True, label="unverified", reason="policy_off")

    video_id = meta.video_id.strip().lower()
    channel = normalize_search_text(meta.author_name or "")
    title = normalize_search_text(meta.title or "")

    blocked_ids = _csv_list(cfg.CONTENT_BLOCK_VIDEO_IDS)
    blocked_channels = _channel_list(cfg.CONTENT_BLOCK_CHANNELS)
    if video_id in blocked_ids or (channel and channel in blocked_channels):
        return Decision(False, "video_blocked", "unverified", "blocklisted")

    allow_ids = _csv_list(cfg.CONTENT_ALLOW_VIDEO_IDS)
    allow_channels = _channel_list(cfg.CONTENT_ALLOW_CHANNELS)
    if allow_ids or allow_channels:
        trusted = video_id in allow_ids or (channel and channel in allow_channels)
        if not trusted:
            return Decision(False, "content_not_lecture", "unverified", "outside_allowlist")
        return Decision(True, label="lecture", reason="allowlist")

    # No metadata means no evidence. Fail open, but never claim it is a lecture.
    if not meta.oembed_checked:
        return Decision(True, label="unverified", reason="metadata_unavailable")

    if any(pattern in title for pattern in NON_LECTURE_PATTERNS):
        return Decision(False, "content_not_lecture", "unverified", "title_pattern")

    if check_length and (
        meta.cue_count < cfg.CONTENT_MIN_CUES
        or meta.duration_seconds < cfg.CONTENT_MIN_DURATION_SECONDS
    ):
        return Decision(False, "content_too_short", "unverified", "too_short")

    return Decision(True, label="lecture", reason="heuristics_passed")
