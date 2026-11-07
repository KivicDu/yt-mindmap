"""A saved mind map belongs to exactly one account and one video.

The whole map lives in the row (nodes + transcript + AI summary) so reopening
a project needs no YouTube round-trip: captions, node notes and pins are all
restored from the database. That is also what makes notes private per user —
the shared video cache is only used for anonymous sessions.
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Project(Base, TimestampMixin):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    # Nullable because a map can be built from an uploaded .srt/.vtt file.
    video_id: Mapped[str | None] = mapped_column(String(11), index=True, nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)

    nodes: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    transcript: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    transcript_language: Mapped[str | None] = mapped_column(String(20), nullable=True)
    summary_so_far: Mapped[str] = mapped_column(Text, default="", nullable=False)
    consumed_until: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    # Autosave writes a draft; an explicit "save" promotes it to a project.
    is_draft: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Sharing: private (owner only), unlisted (anyone with the link) or
    # invited (only addresses in ProjectMember). The slug is the capability;
    # turning sharing off clears it so an old link can never be reused.
    visibility: Mapped[str] = mapped_column(
        String(20), default="private", nullable=False
    )
    share_slug: Mapped[str | None] = mapped_column(
        String(24), unique=True, index=True, nullable=True
    )
    # Role granted by the link itself; invited members carry their own role.
    link_role: Mapped[str] = mapped_column(
        String(20), default="viewer", nullable=False
    )

    last_opened_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
