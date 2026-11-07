"""Who else can open a project, and with which role.

Membership is keyed by email, not by user id, because the owner may invite
someone before that person has an account. The moment they sign in with that
address the invitation starts working, and the project appears under
"Được chia sẻ với tôi" in their dashboard.
"""

from uuid import uuid4

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class ProjectMember(Base, TimestampMixin):
    __tablename__ = "project_members"
    __table_args__ = (
        UniqueConstraint("project_id", "email", name="uq_project_members_project_email"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    email: Mapped[str] = mapped_column(String(320), index=True, nullable=False)
    # "viewer" (read-only) or "editor" (may change the map).
    role: Mapped[str] = mapped_column(String(20), default="viewer", nullable=False)
