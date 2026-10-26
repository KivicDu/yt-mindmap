"""Pure helpers for turning a transcript into incremental chunks.

Kept free of FastAPI / AI dependencies so the rules that protect token cost
can be unit-tested directly.
"""

from typing import Any

MAX_CHUNK_SECONDS = 180.0
LOOKAHEAD_SECONDS = 2.0
MAX_CHUNK_ENTRIES = 300
SEEK_BACKWARD_TOLERANCE = 1.0

Chunk = list[dict[str, Any]]


def is_seek_backward(last_time: float, consumed_until: float) -> bool:
    """True when playback moved behind already processed content."""
    return last_time + LOOKAHEAD_SECONDS + SEEK_BACKWARD_TOLERANCE < consumed_until


def select_chunk(
    transcript: Chunk,
    last_time: float,
    consumed_until: float,
) -> Chunk:
    """Pick the unprocessed transcript entries the user has just watched.

    A small look-ahead avoids waiting for the next tick at chunk boundaries.
    Forward jumps are capped by MAX_CHUNK_SECONDS and MAX_CHUNK_ENTRIES so a
    long seek cannot create an unbounded (and expensive) AI request.
    """
    window_end = last_time + LOOKAHEAD_SECONDS
    window_limit = consumed_until + MAX_CHUNK_SECONDS
    chunk: Chunk = []

    for entry in transcript:
        start = float(entry.get("start", 0) or 0)
        if start <= consumed_until + 0.1:
            continue
        if start > window_end or start > window_limit:
            break
        chunk.append(entry)
        if len(chunk) >= MAX_CHUNK_ENTRIES:
            break

    return chunk


def chunk_time_range(chunk: Chunk) -> tuple[float, float]:
    """Start/end (seconds) covered by a chunk, used for prompts and links."""
    start = min(float(c.get("start", 0) or 0) for c in chunk)
    end = max(
        float(c.get("start", 0) or 0) + float(c.get("duration", 0) or 0)
        for c in chunk
    )
    return start, end
