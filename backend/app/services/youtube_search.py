"""ADR 0016: server-side YouTube search with a hard Data API budget.

The browser never sees the key. Each successful page costs 100 units for
``search.list`` and 1 for ``videos.list``; results are cached briefly and the
whole process shares a daily cap. Anything that fails (no key, no permission,
network error) degrades to ``unavailable`` so the existing paste-a-link box
still works.
"""

from __future__ import annotations

import asyncio
import re
import time
from collections import OrderedDict
from typing import Any, Literal

import httpx

from app.core.config import Settings, get_settings
from app.schemas.youtube_search import SearchResponse, SearchResult
from app.services import content_policy, video_topics
from app.services.rate_limit import youtube_quota
from app.utils.text import normalize_search_text

SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
SEARCH_UNITS = 100
VIDEOS_UNITS = 1
MAX_CACHE_ENTRIES = 200

_DURATION = re.compile(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")
_CACHE: OrderedDict[str, tuple[float, SearchResponse]] = OrderedDict()
_CACHE_LOCK = asyncio.Lock()
# Serialise fetches: concurrent identical searches must not burn the same quota
# twice before the first response lands in the cache.
_FETCH_LOCK = asyncio.Lock()


def reset_search_cache() -> None:
    """Drop every cached page (tests and operator use)."""
    _CACHE.clear()


def parse_iso_duration(value: Any) -> int | None:
    """Turn ``PT1H2M3S`` into seconds; malformed or zero values are unknown."""
    if not isinstance(value, str):
        return None
    match = _DURATION.fullmatch(value.strip())
    if not match:
        return None
    hours, minutes, seconds = (int(part or 0) for part in match.groups())
    total = hours * 3600 + minutes * 60 + seconds
    return total or None


def _fit(
    video_id: str,
    title: str,
    channel: str,
    duration: int | None,
    settings: Settings,
) -> tuple[Literal["likely", "unknown", "blocked"], str, str | None]:
    decision = content_policy.evaluate(
        content_policy.VideoMetadata(
            video_id=video_id,
            title=title,
            author_name=channel,
            # Data API confirmed the video exists and supplied its title, which
            # is the same evidence oEmbed gives the paste-a-link flow.
            oembed_checked=bool(title),
            duration_seconds=duration or 0,
        ),
        settings,
        check_length=False,
    )
    reason_map = {
        "video_blocked": "Kênh hoặc video này nằm trong danh sách không cho phép.",
        "content_not_lecture": "Tiêu đề có dấu hiệu không phải bài giảng.",
        "outside_allowlist": "Video không nằm trong danh sách kênh được phép.",
    }
    if not decision.allowed:
        return (
            "blocked",
            "Không phù hợp",
            reason_map.get(decision.code or "", "Video không vượt qua chính sách nội dung."),
        )
    if duration is not None and duration < settings.CONTENT_MIN_DURATION_SECONDS:
        minutes = max(1, settings.CONTENT_MIN_DURATION_SECONDS // 60)
        return ("unknown", "Quá ngắn để học", f"Video ngắn hơn {minutes} phút.")
    if decision.label == "lecture":
        return ("likely", "Có vẻ là bài giảng", None)
    return ("unknown", "Chưa rõ", None)


class YouTubeSearchService:
    """Fetch one search page and shape it for the UI.

    ``client`` is injectable so tests use a fake with ``.get(url, params)``.
    No client is created until a search actually runs.
    """

    def __init__(self, settings: Settings | None = None, client: Any = None) -> None:
        self.settings = settings or get_settings()
        self._client = client

    @property
    def available(self) -> bool:
        return bool(self.settings.YOUTUBE_SEARCH_ENABLED and self.settings.YOUTUBE_DATA_API_KEY)

    @property
    def _api_key(self) -> str:
        key = self.settings.YOUTUBE_DATA_API_KEY
        return key.get_secret_value() if key is not None else ""

    async def _get(self, url: str, params: dict[str, Any]) -> Any:
        if self._client is not None:
            return await self._client.get(url, params=params)
        async with httpx.AsyncClient(timeout=8.0) as client:
            return await client.get(url, params=params)

    async def search(self, query: str, page_token: str | None = None) -> SearchResponse:
        if not self.available:
            return SearchResponse(
                unavailable=True,
                message="Tìm kiếm chưa được bật. Bạn vẫn có thể dán link YouTube để học.",
            )
        normalized = normalize_search_text(query)
        if len(normalized) < 2:
            return SearchResponse(
                unavailable=True, message="Nhập ít nhất 2 ký tự để tìm video."
            )

        limit = max(1, min(20, int(self.settings.YOUTUBE_SEARCH_MAX_RESULTS)))
        cache_key = f"{normalized}|{page_token or ''}|{limit}"
        ttl = max(0, int(self.settings.YOUTUBE_SEARCH_CACHE_TTL_SECONDS))
        cached = _CACHE.get(cache_key)
        if cached is not None and time.monotonic() - cached[0] < ttl:
            return cached[1]

        async with _FETCH_LOCK:
            cached = _CACHE.get(cache_key)
            if cached is not None and time.monotonic() - cached[0] < ttl:
                return cached[1]

            allowed, _ = youtube_quota.consume_units(
                "youtube_search:global",
                SEARCH_UNITS + VIDEOS_UNITS,
                int(self.settings.YOUTUBE_SEARCH_DAILY_UNITS),
            )
            if not allowed:
                return SearchResponse(
                    unavailable=True,
                    message="Hôm nay đã hết hạn mức tìm kiếm YouTube. Dán link video để tiếp tục.",
                )

            params: dict[str, Any] = {
                "part": "snippet",
                "type": "video",
                "maxResults": limit,
                "q": normalized,
                "key": self._api_key,
            }
            if page_token:
                params["pageToken"] = page_token
            try:
                search_response = await self._get(SEARCH_URL, params)
                if search_response.status_code >= 400:
                    return self._http_failure(search_response)
                search_payload = search_response.json()
                video_ids = self._video_ids(search_payload)
                details_payload: dict[str, Any] = {"items": []}
                if video_ids:
                    details_response = await self._get(
                        VIDEOS_URL,
                        {
                            "part": "snippet,contentDetails",
                            "id": ",".join(video_ids),
                            "key": self._api_key,
                        },
                    )
                    if details_response.status_code >= 400:
                        return self._http_failure(details_response)
                    details_payload = details_response.json()
            except Exception:
                # Never surface the exception: httpx URLs contain the API key.
                return SearchResponse(
                    unavailable=True,
                    message="Không kết nối được với YouTube. Dán link video để tiếp tục.",
                )

            result = SearchResponse(
                items=self._results(query, search_payload, details_payload),
                next_page_token=self._next_page_token(search_payload),
            )
            _CACHE[cache_key] = (time.monotonic(), result)
            _CACHE.move_to_end(cache_key)
            while len(_CACHE) > MAX_CACHE_ENTRIES:
                _CACHE.popitem(last=False)
            return result

    @staticmethod
    def _http_failure(response: Any) -> SearchResponse:
        # Only a stable reason code is inspected; the body is never returned,
        # because error URLs can echo the query string that holds the key.
        reason = ""
        try:
            errors = response.json().get("error", {}).get("errors", [])
            if errors and isinstance(errors[0], dict):
                reason = str(errors[0].get("reason", ""))
        except Exception:
            pass
        if reason == "quotaExceeded":
            message = "Hôm nay đã hết hạn mức tìm kiếm YouTube. Dán link video để tiếp tục."
        else:
            message = "YouTube chưa trả về kết quả. Dán link video để tiếp tục."
        return SearchResponse(unavailable=True, message=message)

    @staticmethod
    def _video_ids(payload: Any) -> list[str]:
        items = payload.get("items", []) if isinstance(payload, dict) else []
        ids: list[str] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            video_id = item.get("id", {})
            video_id = video_id.get("videoId") if isinstance(video_id, dict) else video_id
            if isinstance(video_id, str) and video_id not in ids:
                ids.append(video_id)
        return ids

    @staticmethod
    def _next_page_token(payload: Any) -> str | None:
        if not isinstance(payload, dict):
            return None
        token = payload.get("nextPageToken")
        return token if isinstance(token, str) and token else None

    def _results(
        self, query: str, search_payload: Any, details_payload: Any
    ) -> list[SearchResult]:
        details: dict[str, dict[str, Any]] = {}
        raw_details = details_payload.get("items", []) if isinstance(details_payload, dict) else []
        for item in raw_details:
            if isinstance(item, dict) and isinstance(item.get("id"), str):
                details[item["id"]] = item

        results: list[SearchResult] = []
        raw_items = search_payload.get("items", []) if isinstance(search_payload, dict) else []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            identifiers = item.get("id", {})
            video_id = (
                identifiers.get("videoId") if isinstance(identifiers, dict) else identifiers
            )
            if not isinstance(video_id, str) or not video_id:
                continue
            snippet = item.get("snippet", {}) if isinstance(item.get("snippet"), dict) else {}
            detail = details.get(video_id, {})
            detail_snippet = (
                detail.get("snippet", {}) if isinstance(detail.get("snippet"), dict) else {}
            )
            title = str(
                detail_snippet.get("title") or snippet.get("title") or "Video YouTube"
            )
            channel = str(
                detail_snippet.get("channelTitle") or snippet.get("channelTitle") or ""
            )
            thumbnails = snippet.get("thumbnails", {})
            thumbnail = None
            if isinstance(thumbnails, dict):
                for size in ("medium", "default", "high"):
                    candidate = thumbnails.get(size, {})
                    if isinstance(candidate, dict) and isinstance(candidate.get("url"), str):
                        thumbnail = candidate["url"]
                        break
            duration = parse_iso_duration(detail.get("contentDetails", {}).get("duration"))
            raw_tags = detail_snippet.get("tags", [])
            tags = (
                tuple(tag for tag in raw_tags if isinstance(tag, str))
                if isinstance(raw_tags, list)
                else ()
            )
            topic = video_topics.classify(query, title, channel, tags)
            fit, fit_label, fit_reason = _fit(video_id, title, channel, duration, self.settings)
            results.append(
                SearchResult(
                    video_id=video_id,
                    url=f"https://www.youtube.com/watch?v={video_id}",
                    title=title,
                    channel=channel,
                    thumbnail=thumbnail,
                    duration_seconds=duration,
                    topic_code=topic["code"],
                    topic_label=topic["label"],
                    fit=fit,
                    fit_label=fit_label,
                    fit_reason=fit_reason,
                )
            )
        return results
