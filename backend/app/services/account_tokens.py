"""Issue and consume the one-shot links used by account actions.

Three purposes share one table:

* ``verify_email`` -- confirm the address on the account.
* ``password_reset`` -- choose a new password after forgetting the old one.
* ``email_change`` -- confirm the address the account wants to move to; the
  target address is stored on the row, not in the token.

Only a SHA-256 hash is stored, tokens are single-use and expire, and issuing a
new token for the same user/purpose replaces the previous one.
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models.account_token import AccountToken
from app.models.user import User

PURPOSE_VERIFY_EMAIL = "verify_email"
PURPOSE_PASSWORD_RESET = "password_reset"
PURPOSE_EMAIL_CHANGE = "email_change"

TTL_BY_PURPOSE = {
    PURPOSE_VERIFY_EMAIL: timedelta(hours=24),
    PURPOSE_PASSWORD_RESET: timedelta(hours=1),
    PURPOSE_EMAIL_CHANGE: timedelta(hours=1),
}

# Stop a signed-in user (or an attacker with their session) from spraying a
# third-party inbox. Verification is exempt: it only targets the account owner.
MIN_INTERVAL_BY_PURPOSE = {
    PURPOSE_VERIFY_EMAIL: timedelta(0),
    PURPOSE_PASSWORD_RESET: timedelta(seconds=60),
    PURPOSE_EMAIL_CHANGE: timedelta(seconds=60),
}


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _as_utc(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; normalise before comparing."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def issue_token(
    db: Session,
    user: User,
    purpose: str,
    *,
    email: str | None = None,
    min_interval: timedelta | None = None,
) -> str | None:
    """Replace the pending token for this purpose and return the raw value.

    Returns ``None`` when a token was issued too recently (the caller should
    behave as if it sent another message). The raw token is never stored; only
    its hash reaches the database.
    """
    now = utcnow()
    interval = MIN_INTERVAL_BY_PURPOSE.get(purpose, timedelta(0))
    if min_interval is not None:
        interval = min_interval

    if interval:
        latest = db.scalar(
            select(AccountToken)
            .where(
                AccountToken.user_id == user.id,
                AccountToken.purpose == purpose,
            )
            .order_by(AccountToken.created_at.desc())
            .limit(1)
        )
        if latest is not None and _as_utc(latest.created_at) > now - interval:
            return None

    db.execute(
        delete(AccountToken).where(
            AccountToken.user_id == user.id,
            AccountToken.purpose == purpose,
        )
    )
    raw_token = secrets.token_urlsafe(32)
    db.add(
        AccountToken(
            user_id=user.id,
            purpose=purpose,
            token_hash=_hash(raw_token),
            email=email,
            expires_at=now + TTL_BY_PURPOSE[purpose],
        )
    )
    db.commit()
    return raw_token


def find_token(db: Session, raw_token: str, purpose: str) -> AccountToken | None:
    """Return a usable token row, without consuming it.

    The caller marks ``used_at`` in the same transaction as the action it
    performs, so a failure cannot burn a link.
    """
    row = db.scalar(
        select(AccountToken).where(
            AccountToken.token_hash == _hash(raw_token),
            AccountToken.purpose == purpose,
        )
    )
    if row is None or row.used_at is not None:
        return None
    if _as_utc(row.expires_at) <= utcnow():
        return None
    return row


def discard_token(db: Session, user_id: str, purpose: str) -> None:
    """Drop the pending token for one purpose (e.g. delivery failed)."""
    db.execute(
        delete(AccountToken).where(
            AccountToken.user_id == user_id,
            AccountToken.purpose == purpose,
        )
    )
    db.commit()


def discard_all_tokens(db: Session, user_id: str) -> None:
    """Invalidate every pending account link after a security-sensitive change."""
    db.execute(delete(AccountToken).where(AccountToken.user_id == user_id))
    db.commit()
