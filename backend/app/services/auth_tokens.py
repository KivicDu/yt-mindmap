"""Issue, rotate and revoke the refresh tokens a browser holds.

Every refresh token is registered by its JWT ``jti`` and belongs to a
``family_id``. Refreshing revokes the old row and writes a new one in the same
family (rotation), so a captured cookie stops working once the real client
refreshes. If a revoked token is replayed, the whole family is revoked: a thief
who refreshes first cannot keep the legitimate browser's token alive.

Logout and password changes revoke rows too; the access token still lives until
it expires, which keeps request handling stateless.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models.refresh_token import RefreshToken
from app.utils.security import create_token, decode_token


@dataclass(frozen=True)
class RefreshOutcome:
    """Result of consuming a refresh cookie.

    ``reuse_detected`` is set only when a token that was already rotated is
    presented again; the caller should clear cookies and sign the user out.
    """

    user_id: str | None = None
    family_id: str | None = None
    reuse_detected: bool = False


def _as_utc(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; normalise before comparing."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def issue_refresh_token(db: Session, user_id: str, family_id: str | None = None) -> str:
    """Create a refresh token in a (new or existing) family and remember it."""
    family_id = family_id or uuid4().hex
    token, _ = create_token(user_id, "refresh", family_id)
    payload = decode_token(token, "refresh")
    if payload is None:  # pragma: no cover - a token we just signed must decode
        raise RuntimeError("could not decode a freshly created refresh token")

    db.add(
        RefreshToken(
            jti=payload["jti"],
            user_id=user_id,
            family_id=family_id,
            expires_at=datetime.fromtimestamp(payload["exp"], UTC),
        )
    )
    db.commit()
    return token


def consume_refresh_token(db: Session, token: str) -> RefreshOutcome:
    """Validate a refresh token and rotate its row, or report why it failed."""
    payload = decode_token(token, "refresh")
    if payload is None:
        return RefreshOutcome()

    row = db.get(RefreshToken, payload["jti"])
    if row is None or row.user_id != payload["sub"]:
        return RefreshOutcome()
    family = payload.get("fam")
    if family is not None and family != row.family_id:
        return RefreshOutcome()
    if _as_utc(row.expires_at) <= utcnow():
        return RefreshOutcome()

    # Legacy tokens (issued before families existed) have no `fam` claim; their
    # rows have a NULL family id and are grouped together here.
    row_family = family if isinstance(family, str) else row.family_id
    if row.revoked_at is not None:
        revoke_refresh_family(db, row.user_id, row_family)
        return RefreshOutcome(user_id=row.user_id, reuse_detected=True)

    row.revoked_at = utcnow()
    db.commit()
    return RefreshOutcome(user_id=row.user_id, family_id=row_family)


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


def revoke_refresh_family(db: Session, user_id: str, family_id: str | None) -> None:
    """Revoke every unused token in one rotated chain."""
    statement = update(RefreshToken).where(
        RefreshToken.user_id == user_id,
        RefreshToken.revoked_at.is_(None),
    )
    if family_id is None:
        statement = statement.where(RefreshToken.family_id.is_(None))
    else:
        statement = statement.where(RefreshToken.family_id == family_id)
    db.execute(statement.values(revoked_at=utcnow()))
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
