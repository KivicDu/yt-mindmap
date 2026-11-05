"""Email/password auth plus the refresh-cookie lifecycle.

Token model: the access token lives in the client's memory and travels in the
``Authorization`` header; the refresh token lives in an HttpOnly cookie so a
script injected into the page cannot read it. Refresh rotates the cookie, so a
stolen old token stops working as soon as the real client refreshes.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.db.base import utcnow
from app.db.session import get_db
from app.models.user import User
from app.schemas.auth import (
    AccessTokenResponse,
    AuthResponse,
    LoginRequest,
    RegisterRequest,
    UserOut,
)
from app.services.accounts import normalize_email
from app.utils.cookies import clear_session_cookies, set_session_cookies
from app.utils.security import create_token, decode_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _auth_response(response: Response, user: User) -> AuthResponse:
    access_token, expires_in = create_token(user.id, "access")
    set_session_cookies(response, user.id)
    return AuthResponse(
        access_token=access_token,
        expires_in=expires_in,
        user=UserOut.model_validate(user),
    )


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)) -> AuthResponse:
    email = normalize_email(payload.email)
    exists = db.scalar(select(User).where(User.email == email))
    if exists is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email_taken")

    user = User(
        email=email,
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
        provider="local",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _auth_response(response, user)


@router.post("/login")
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)) -> AuthResponse:
    email = normalize_email(payload.email)
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_credentials"
        )
    user.last_login_at = utcnow()
    db.commit()
    db.refresh(user)
    return _auth_response(response, user)


@router.post("/refresh")
def refresh(
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
) -> AccessTokenResponse:
    settings = get_settings()
    refresh_token = request.cookies.get(settings.REFRESH_COOKIE_NAME)
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing_refresh_token")
    payload = decode_token(refresh_token, "refresh")
    if payload is None:
        clear_session_cookies(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_refresh_token")
    user = db.get(User, payload["sub"])
    if user is None:
        clear_session_cookies(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_refresh_token")

    access_token, expires_in = create_token(user.id, "access")
    set_session_cookies(response, user.id)
    return AccessTokenResponse(access_token=access_token, expires_in=expires_in)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> None:
    clear_session_cookies(response)


@router.get("/me")
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)
