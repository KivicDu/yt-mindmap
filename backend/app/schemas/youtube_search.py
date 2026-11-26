"""ADR 0016: what the search box sends back, without any credential."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

StudyFit = Literal["likely", "unknown", "blocked"]


class SearchResult(BaseModel):
    video_id: str
    url: str
    title: str
    channel: str
    thumbnail: str | None = None
    duration_seconds: int | None = None
    topic_code: str
    topic_label: str
    fit: StudyFit
    fit_label: str
    fit_reason: str | None = None


class SearchResponse(BaseModel):
    items: list[SearchResult] = Field(default_factory=list)
    next_page_token: str | None = None
    unavailable: bool = False
    message: str | None = None
