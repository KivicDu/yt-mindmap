"""Issue, rotate and revoke the refresh tokens a browser holds.

Every refresh token is registered by its JWT ``jti``. Refreshing revokes the
old row and writes a new one (rotation), so replaying a captured cookie fails.
Logout and password changes revoke rows too; the access token still lives until
it expires, which keeps request handling stateless.
"""

from datetime import UTC, datetime

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models.refresh_token import RefreshToken
from app.utils.security import create_token, decode_token


def _as_utc(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; normalise before comparing."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def issue_refresh_token(db: Session, user_id: str) -> str:
    """Create a refresh token and remember it. Returns the raw JWT."""
    token, _ = create_token(user_id, "refresh")
    payload = decode_token(token, "refresh")
    if payload is None:  # pragma: no cover - a token we just signed must decode
        raise RuntimeError("could not decode a freshly created refresh token")

    db.add(
        RefreshToken(
            jti=payload["jti"],
            user_id=user_id,
            expires_at=datetime.fromtimestamp(payload["exp"], UTC),
        )
    )
    db.commit()
    return token


def consume_refresh_token(db: Session, token: str) -> str | None:
    """Validate and revoke a refresh token, returning its user id.

    Rotation is one-shot: the same token cannot be consumed twice, which is
    what makes a copied cookie stop working after the real client refreshes.
    """
    payload = decode_token(token, "refresh")
    if payload is None:
        return None

    row = db.get(RefreshToken, payload["jti"])
    if row is None or row.revoked_at is not None:
        return None
    if _as_utc(row.expires_at) <= utcnow():
        return None
    if row.user_id != payload["sub"]:
        return None

    row.revoked_at = utcnow()
    db.commit()
    return row.user_id


def revoke_refresh_token(db: Session, token: str | None) -> None:
    """Revoke one token if it is still known. Unknown tokens are ignored."""
    if not token:
        return
    payload = decode_token(token, "refresh")
    if payload is None:
        return
    row = db.get(RefreshToken, payload["jti"])
    if row is not None and row.revoked_at is None:
        row.revoked_at = utcnow()
        db.commit()


def revoke_all_refresh_tokens(db: Session, user_id: str) -> None:
    """Sign the account out everywhere (used after a password change)."""
    db.execute(
        update(RefreshToken)
        .where(
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=utcnow())
    )
    db.commit()
