"""Snapshots of a project's map, used to undo an AI update.

Only the map state is versioned. The transcript and the sharing settings do not
change when the AI merges a chunk, so storing them again on every snapshot would
multiply the row size for no benefit.
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import JSON, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class ProjectVersion(Base):
    __tablename__ = "project_versions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # Who was editing when the snapshot was taken (nullable for old rows).
    author_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    nodes: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    summary_so_far: Mapped[str] = mapped_column(Text, default="", nullable=False)
    consumed_until: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
