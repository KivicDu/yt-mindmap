"""Server-side registry of refresh tokens.

Access tokens stay stateless and short-lived (15 minutes). A refresh token, on
the other hand, is only usable while its ``jti`` row exists and has not been
revoked. Logging out or changing the password marks rows revoked, so a cookie
copied from the browser cannot keep minting access tokens forever.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    # The JWT already carries a random ``jti``; using it as the primary key
    # keeps the table small and makes rotation a single lookup.
    jti: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
