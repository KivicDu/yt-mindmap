"""Shared FastAPI dependencies (currently: the signed-in user)."""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.utils.security import decode_token

bearer_scheme = HTTPBearer(auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="not_authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _UNAUTHORIZED
    payload = decode_token(credentials.credentials, "access")
    if payload is None:
        raise _UNAUTHORIZED
    user = db.get(User, payload["sub"])
    if user is None:
        raise _UNAUTHORIZED
    return user


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    """Like ``get_current_user``, but anonymous callers are allowed.

    Used by endpoints that work for guests *and* get extra behaviour when the
    caller owns a saved project (resuming a map, autosaving it).
    """

    if credentials is None or credentials.scheme.lower() != "bearer":
        return None
    payload = decode_token(credentials.credentials, "access")
    if payload is None:
        return None
    return db.get(User, payload["sub"])
