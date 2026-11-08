"""One-shot tokens behind account actions.

Every action link (verify email, reset password, confirm a new email) is a
random token whose SHA-256 hash is stored here. A leaked database row cannot be
turned back into a working link. There is at most one token per user and
purpose, so issuing a new one replaces the previous link.
"""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class AccountToken(Base):
    __tablename__ = "account_tokens"
    __table_args__ = (
        UniqueConstraint("user_id", "purpose", name="uq_account_tokens_user_purpose"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # verify_email | password_reset | email_change
    purpose: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False
    )
    # Only set for email_change: the address the account wants to move to.
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
