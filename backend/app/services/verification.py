"""Email-verification tokens and the development "outbox".

Phase 4 has no SMTP transport yet: the link is written to the server log, and
``DEBUG_EMAIL_LINKS`` optionally returns it to the browser so local end-to-end
testing does not need a mail server. Swapping in SMTP later only means replacing
``deliver``; the token lifecycle stays the same.
"""

import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.base import utcnow
from app.models.email_verification import EmailVerificationToken
from app.models.user import User

logger = logging.getLogger(__name__)

TOKEN_TTL_HOURS = 24


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _build_link(raw_token: str) -> str:
    settings = get_settings()
    base = settings.FRONTEND_URL.rstrip("/")
    return f"{base}/verify-email?token={raw_token}"


def issue_verification_token(db: Session, user: User) -> str:
    """Replace any pending token and return the link to deliver.

    Issuing invalidates older links for the same account, so only the newest
    email works. The link is logged in development instead of being emailed.
    """
    db.execute(
        delete(EmailVerificationToken).where(EmailVerificationToken.user_id == user.id)
    )
    raw_token = secrets.token_urlsafe(32)
    db.add(
        EmailVerificationToken(
            user_id=user.id,
            token_hash=_hash(raw_token),
            expires_at=utcnow() + timedelta(hours=TOKEN_TTL_HOURS),
        )
    )
    db.commit()

    link = _build_link(raw_token)
    logger.info("Email verification link for %s: %s", user.email, link)
    return link


def verify_email(db: Session, raw_token: str) -> User | None:
    """Mark the token used and the account verified. Returns the user or None."""
    row = db.scalar(
        select(EmailVerificationToken).where(
            EmailVerificationToken.token_hash == _hash(raw_token)
        )
    )
    if row is None or row.used_at is not None:
        return None
    if _as_utc(row.expires_at) <= utcnow():
        return None

    user = db.get(User, row.user_id)
    if user is None:
        return None

    row.used_at = utcnow()
    user.email_verified = True
    db.commit()
    db.refresh(user)
    return user
