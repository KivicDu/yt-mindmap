"""Password hashing and the access/refresh JWT pair.

bcrypt is used directly instead of passlib: passlib 1.7 imports the ``crypt``
module, which Python 3.13 removed, and it is no longer maintained.
"""

from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from uuid import uuid4

import bcrypt
import jwt
from jwt import InvalidTokenError

from app.core.config import get_settings

TokenType = Literal["access", "refresh"]

# bcrypt only looks at the first 72 bytes, so longer inputs are rejected
# instead of silently ignored (the request schema enforces the same limit).
BCRYPT_MAX_BYTES = 72


def hash_password(password: str) -> str:
    encoded = password.encode("utf-8")
    if not encoded or len(encoded) > BCRYPT_MAX_BYTES:
        raise ValueError("password length must be 1..72 bytes")
    return bcrypt.hashpw(encoded, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    encoded = password.encode("utf-8")
    if not encoded or len(encoded) > BCRYPT_MAX_BYTES:
        return False
    try:
        return bcrypt.checkpw(encoded, password_hash.encode("utf-8"))
    except ValueError:
        return False


def _ttl(token_type: TokenType) -> timedelta:
    settings = get_settings()
    if token_type == "access":
        return timedelta(minutes=settings.ACCESS_TOKEN_TTL_MINUTES)
    return timedelta(days=settings.REFRESH_TOKEN_TTL_DAYS)


def create_token(subject: str, token_type: TokenType) -> tuple[str, int]:
    """Return ``(token, lifetime_in_seconds)`` for one user id."""
    settings = get_settings()
    now = datetime.now(UTC)
    ttl = _ttl(token_type)
    payload = {
        "sub": subject,
        "typ": token_type,
        "iat": now,
        "exp": now + ttl,
        "jti": uuid4().hex,
    }
    token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return token, int(ttl.total_seconds())


def decode_token(token: str, expected_type: TokenType) -> dict[str, Any] | None:
    """Validate a token and return its claims, or ``None`` when unusable."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except InvalidTokenError:
        return None
    if payload.get("typ") != expected_type:
        return None
    if not isinstance(payload.get("sub"), str) or not payload["sub"]:
        return None
    return payload
