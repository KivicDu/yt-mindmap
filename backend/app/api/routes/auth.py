"""Email/password auth plus the refresh-cookie lifecycle.

Token model: the access token lives in the client's memory and travels in the
``Authorization`` header; the refresh token lives in an HttpOnly cookie so a
script injected into the page cannot read it. Refresh rotates the cookie *and*
the server-side registry row, so a stolen old token stops working as soon as the
real client refreshes.
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
    ChangePasswordRequest,
    LoginRequest,
    RegisterRequest,
    UpdateProfileRequest,
    UserOut,
    VerificationRequestResponse,
    VerifyEmailRequest,
)
from app.services.accounts import normalize_email
from app.services.auth_tokens import (
    consume_refresh_token,
    issue_refresh_token,
    revoke_all_refresh_tokens,
    revoke_refresh_token,
)
from app.services.verification import issue_verification_token, verify_email
from app.utils.cookies import clear_session_cookies, set_session_cookies
from app.utils.security import create_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _auth_response(response: Response, db: Session, user: User) -> AuthResponse:
    access_token, expires_in = create_token(user.id, "access")
    refresh_token = issue_refresh_token(db, user.id)
    set_session_cookies(response, refresh_token)
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
    return _auth_response(response, db, user)


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
    return _auth_response(response, db, user)


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

    user_id = consume_refresh_token(db, refresh_token)
    if user_id is None:
        clear_session_cookies(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_refresh_token")
    user = db.get(User, user_id)
    if user is None:
        clear_session_cookies(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_refresh_token")

    access_token, expires_in = create_token(user.id, "access")
    new_refresh_token = issue_refresh_token(db, user.id)
    set_session_cookies(response, new_refresh_token)
    return AccessTokenResponse(access_token=access_token, expires_in=expires_in)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> None:
    settings = get_settings()
    revoke_refresh_token(db, request.cookies.get(settings.REFRESH_COOKIE_NAME))
    clear_session_cookies(response)


@router.get("/me")
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("/me")
def update_profile(
    payload: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    display_name = payload.display_name.strip()
    if not display_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="display_name_required",
        )
    user.display_name = display_name
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Change the password, then sign out every other device.

    The current browser receives a fresh refresh cookie so the person who just
    changed the password stays signed in; every older refresh token is revoked.
    """
    if user.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="password_not_set"
        )
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="wrong_password"
        )

    user.password_hash = hash_password(payload.new_password)
    db.commit()
    revoke_all_refresh_tokens(db, user.id)
    refresh_token = issue_refresh_token(db, user.id)
    set_session_cookies(response, refresh_token)


@router.post("/verification/request")
def request_email_verification(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VerificationRequestResponse:
    if user.email_verified:
        return VerificationRequestResponse(status="already_verified")

    link = issue_verification_token(db, user)
    settings = get_settings()
    return VerificationRequestResponse(
        status="sent",
        dev_link=link if settings.DEBUG_EMAIL_LINKS else None,
    )


@router.post("/verification/confirm")
def confirm_email_verification(
    payload: VerifyEmailRequest,
    db: Session = Depends(get_db),
) -> UserOut:
    user = verify_email(db, payload.token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid_verification_token",
        )
    return UserOut.model_validate(user)
