"""A finished ASR transcript belongs to the video, not to one learner.

ADR 0012: store it once so a second viewer (or a retry after a server restart)
skips both the audio download and the billable model call. Only cues produced by
the audio fallback are written here; a YouTube caption track is already cached
by the session layer.
"""

from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class VideoTranscript(Base):
    __tablename__ = "video_transcripts"

    video_id: Mapped[str] = mapped_column(String(11), primary_key=True)
    language: Mapped[str | None] = mapped_column(String(20), nullable=True)
    cues: Mapped[list] = mapped_column(JSON, nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="asr")
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
