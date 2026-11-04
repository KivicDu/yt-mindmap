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
from app.utils.security import create_token, decode_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _cookie_kwargs() -> dict:
    settings = get_settings()
    return {
        "key": settings.REFRESH_COOKIE_NAME,
        "httponly": True,
        "secure": settings.COOKIE_SECURE,
        "samesite": settings.COOKIE_SAMESITE,
        "domain": settings.COOKIE_DOMAIN,
        "path": "/",
    }


def _set_refresh_cookie(response: Response, user_id: str) -> None:
    settings = get_settings()
    token, _ = create_token(user_id, "refresh")
    response.set_cookie(
        value=token,
        max_age=settings.refresh_cookie_max_age,
        **_cookie_kwargs(),
    )
    # Readable hint so the app can skip a doomed /auth/refresh on first visit.
    # It carries no secret: the real session lives in the HttpOnly cookie.
    response.set_cookie(
        key=settings.SESSION_HINT_COOKIE_NAME,
        value="1",
        httponly=False,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
        path="/",
        max_age=settings.refresh_cookie_max_age,
    )


def _clear_refresh_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(**_cookie_kwargs())
    response.delete_cookie(
        key=settings.SESSION_HINT_COOKIE_NAME,
        domain=settings.COOKIE_DOMAIN,
        path="/",
    )


def _auth_response(response: Response, user: User) -> AuthResponse:
    access_token, expires_in = create_token(user.id, "access")
    _set_refresh_cookie(response, user.id)
    return AuthResponse(
        access_token=access_token,
        expires_in=expires_in,
        user=UserOut.model_validate(user),
    )


def _normalize_email(email: str) -> str:
    return email.strip().lower()


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)) -> AuthResponse:
    email = _normalize_email(payload.email)
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
    email = _normalize_email(payload.email)
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
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_refresh_token")
    user = db.get(User, payload["sub"])
    if user is None:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_refresh_token")

    access_token, expires_in = create_token(user.id, "access")
    _set_refresh_cookie(response, user.id)
    return AccessTokenResponse(access_token=access_token, expires_in=expires_in)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> None:
    _clear_refresh_cookie(response)


@router.get("/me")
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)


def _oauth_not_configured(provider: str) -> HTTPException:
    settings = get_settings()
    configured = {
        "google": bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET),
        "github": bool(settings.GITHUB_CLIENT_ID and settings.GITHUB_CLIENT_SECRET),
    }[provider]
    detail = {
        "error": "oauth_not_configured" if not configured else "oauth_not_implemented",
        "provider": provider,
        "hint": (
            "Set GOOGLE_CLIENT_ID/SECRET or GITHUB_CLIENT_ID/SECRET in backend/.env "
            "and follow docs/auth-oauth.md once the flow is enabled."
        ),
    }
    return HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=detail)


@router.get("/google")
def google_oauth() -> None:
    raise _oauth_not_configured("google")


@router.get("/github")
def github_oauth() -> None:
    raise _oauth_not_configured("github")
