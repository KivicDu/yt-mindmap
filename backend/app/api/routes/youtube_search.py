"""ADR 0016: the search box's only endpoint.

Public and anonymous like ``/video-info``: it reads public Data API metadata,
never a learner's saved data. The service owns the key and the quota; this
module only validates input and shapes the response.
"""

from fastapi import APIRouter, Depends, Query

from app.schemas.youtube_search import SearchResponse
from app.services.youtube_search import YouTubeSearchService

router = APIRouter()


def get_youtube_search_service() -> YouTubeSearchService:
    return YouTubeSearchService()


@router.get("/youtube/search", response_model=SearchResponse)
async def search_videos(
    q: str = Query(min_length=1, max_length=100),
    page_token: str | None = Query(default=None, max_length=200),
    service: YouTubeSearchService = Depends(get_youtube_search_service),
) -> SearchResponse:
    return await service.search(q, page_token)
