"""In-memory rate limits and daily AI quotas.

The app is still a single process (the session store lives in memory too), so a
small dependency-free limiter is enough. A multi-worker deployment must move
these counters to Redis; the interface is intentionally narrow so that swap is
local to this module.

Two different protections:

* ``SlidingWindowLimiter`` caps bursts (login attempts, AI requests per minute).
* ``DailyQuota`` caps total AI usage per user or anonymous IP per UTC day, which
  bounds the Gemini bill even when requests are spread out.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import UTC, date, datetime
from threading import Lock


@dataclass(frozen=True)
class Limit:
    name: str
    max_requests: int
    window_seconds: float = 60.0


class SlidingWindowLimiter:
    """Allow at most ``max_requests`` per key inside a rolling window."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def hit(self, key: str, limit: Limit, *, now: float | None = None) -> float | None:
        """Record one hit.

        Returns ``None`` when the request is allowed, or the number of seconds
        the caller should wait before retrying.
        """
        current = time.monotonic() if now is None else now
        cutoff = current - limit.window_seconds
        with self._lock:
            bucket = self._hits[key]
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= limit.max_requests:
                return max(0.0, bucket[0] + limit.window_seconds - current)
            bucket.append(current)
            return None

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


class DailyQuota:
    """Count usage per key and reset automatically at the UTC date boundary."""

    def __init__(self) -> None:
        self._counts: dict[str, tuple[date, int]] = {}
        self._lock = Lock()

    def consume_units(
        self, key: str, units: int, limit: int, *, today: date | None = None
    ) -> tuple[bool, int]:
        """Consume ``units`` at once.

        Returns ``(allowed, remaining)``. When blocked, ``remaining`` is 0 and
        the counter is left unchanged, so a rejected batch never spends quota.
        """
        amount = max(0, int(units))
        current_day = datetime.now(UTC).date() if today is None else today
        with self._lock:
            day, count = self._counts.get(key, (current_day, 0))
            if day != current_day:
                day, count = current_day, 0
            if count + amount > limit:
                self._counts[key] = (day, count)
                return False, max(0, limit - count)
            count += amount
            self._counts[key] = (day, count)
            return True, max(0, limit - count)

    def consume(
        self, key: str, limit: int, *, today: date | None = None
    ) -> tuple[bool, int]:
        """Consume one unit."""
        return self.consume_units(key, 1, limit, today=today)

    def reset(self) -> None:
        with self._lock:
            self._counts.clear()


auth_limiter = SlidingWindowLimiter()
ai_limiter = SlidingWindowLimiter()
get_limiter = SlidingWindowLimiter()
ai_quota = DailyQuota()
# ADR 0012: audio transcription is billed per run, so it gets its own daily
# allowance. This one is keyed `asr:user:<id>` and never touches ai_quota.
asr_quota = DailyQuota()
# ADR 0016: YouTube Data API quota is shared by the whole process, not per user.
youtube_quota = DailyQuota()


def reset_rate_limits() -> None:
    """Clear every counter (tests and local development reloads)."""
    auth_limiter.reset()
    ai_limiter.reset()
    get_limiter.reset()
    ai_quota.reset()
    asr_quota.reset()
    youtube_quota.reset()
