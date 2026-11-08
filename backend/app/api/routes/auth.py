"""Email/password auth plus the refresh-cookie lifecycle.

Token model: the access token lives in the client's memory and travels in the
``Authorization`` header; the refresh token lives in an HttpOnly cookie so a
script injected into the page cannot read it. Refresh rotates the cookie *and*
the server-side registry row, so a stolen old token stops working as soon as the
real client refreshes.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.db.base import utcnow
from app.db.session import get_db
from app.models.user import User
from app.schemas.auth import (
    AccessTokenResponse,
    ActionResponse,
    AuthResponse,
    ChangePasswordRequest,
    ConfirmEmailChangeRequest,
    EmailChangeRequest,
    EmailChangeRequestResponse,
    ForgotPasswordRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    UpdateProfileRequest,
    UserOut,
    VerificationRequestResponse,
    VerifyEmailRequest,
)
from app.services.account_emails import (
    email_change_link,
    password_reset_link,
    send_email_change_email,
    send_email_changed_notice,
    send_password_reset_email,
    send_verification_email,
    verification_link,
)
from app.services.account_tokens import (
    PURPOSE_EMAIL_CHANGE,
    PURPOSE_PASSWORD_RESET,
    PURPOSE_VERIFY_EMAIL,
    discard_all_tokens,
    discard_token,
    find_token,
    issue_token,
)
from app.services.accounts import normalize_email
from app.services.auth_tokens import (
    consume_refresh_token,
    issue_refresh_token,
    revoke_all_refresh_tokens,
    revoke_refresh_token,
)
from app.services.emailer import EmailDeliveryError
from app.utils.cookies import clear_session_cookies, set_session_cookies
from app.utils.security import create_token, hash_password, verify_password

logger = logging.getLogger(__name__)

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
    discard_all_tokens(db, user.id)
    revoke_all_refresh_tokens(db, user.id)
    refresh_token = issue_refresh_token(db, user.id)
    set_session_cookies(response, refresh_token)


@router.post("/password/forgot")
def forgot_password(
    payload: ForgotPasswordRequest,
    db: Session = Depends(get_db),
) -> ActionResponse:
    """Send a reset link when the address belongs to a password account.

    The response is identical for unknown addresses and OAuth-only accounts so
    the endpoint cannot be used to enumerate accounts.
    """
    email = normalize_email(payload.email)
    user = db.scalar(select(User).where(User.email == email))
    if user is not None and user.password_hash is not None:
        raw_token = issue_token(db, user, PURPOSE_PASSWORD_RESET)
        if raw_token is not None:
            link = password_reset_link(raw_token)
            try:
                send_password_reset_email(user.email, link)
            except EmailDeliveryError:
                # Leave no pending token behind so a retry can send immediately.
                discard_token(db, user.id, PURPOSE_PASSWORD_RESET)
                logger.warning("Password reset email failed for user %s", user.id)
    return ActionResponse(status="sent")


@router.post("/password/reset", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    payload: ResetPasswordRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> None:
    row = find_token(db, payload.token, PURPOSE_PASSWORD_RESET)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_reset_token"
        )

    user = db.get(User, row.user_id)
    if user is None or user.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_reset_token"
        )

    user.password_hash = hash_password(payload.new_password)
    row.used_at = utcnow()
    db.commit()

    # A reset is a recovery event: drop other pending links and every session.
    discard_all_tokens(db, user.id)
    revoke_all_refresh_tokens(db, user.id)
    clear_session_cookies(response)


@router.post("/verification/request")
def request_email_verification(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VerificationRequestResponse:
    if user.email_verified:
        return VerificationRequestResponse(status="already_verified")

    raw_token = issue_token(db, user, PURPOSE_VERIFY_EMAIL)
    if raw_token is None:  # pragma: no cover - verification has no cooldown
        return VerificationRequestResponse(status="sent")

    link = verification_link(raw_token)
    try:
        send_verification_email(user.email, link)
    except EmailDeliveryError:
        discard_token(db, user.id, PURPOSE_VERIFY_EMAIL)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="email_delivery_failed"
        ) from None

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
    row = find_token(db, payload.token, PURPOSE_VERIFY_EMAIL)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid_verification_token",
        )

    user = db.get(User, row.user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid_verification_token",
        )

    row.used_at = utcnow()
    user.email_verified = True
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.post("/email/request")
def request_email_change(
    payload: EmailChangeRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EmailChangeRequestResponse:
    new_email = normalize_email(payload.new_email)
    if new_email == user.email:
        return EmailChangeRequestResponse(status="unchanged")

    taken = db.scalar(
        select(User).where(User.email == new_email, User.id != user.id)
    )
    if taken is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email_taken")

    if user.password_hash is not None:
        if not payload.current_password or not verify_password(
            payload.current_password, user.password_hash
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="wrong_password"
            )

    raw_token = issue_token(db, user, PURPOSE_EMAIL_CHANGE, email=new_email)
    if raw_token is None:
        # A link was sent moments ago and is still valid.
        return EmailChangeRequestResponse(status="sent")

    link = email_change_link(raw_token)
    try:
        send_email_change_email(new_email, link)
    except EmailDeliveryError:
        discard_token(db, user.id, PURPOSE_EMAIL_CHANGE)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="email_delivery_failed"
        ) from None

    settings = get_settings()
    return EmailChangeRequestResponse(
        status="sent",
        dev_link=link if settings.DEBUG_EMAIL_LINKS else None,
    )


@router.post("/email/confirm")
def confirm_email_change(
    payload: ConfirmEmailChangeRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> UserOut:
    row = find_token(db, payload.token, PURPOSE_EMAIL_CHANGE)
    if row is None or not row.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid_email_change_token",
        )

    user = db.get(User, row.user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid_email_change_token",
        )

    new_email = normalize_email(row.email)
    taken = db.scalar(
        select(User).where(User.email == new_email, User.id != user.id)
    )
    if taken is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email_taken")

    old_email = user.email
    user.email = new_email
    user.email_verified = True
    row.used_at = utcnow()
    try:
        db.commit()
    except IntegrityError:
        # Someone claimed the address between the request and the click.
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="email_taken"
        ) from None

    discard_all_tokens(db, user.id)
    revoke_all_refresh_tokens(db, user.id)
    clear_session_cookies(response)
    db.refresh(user)

    # The old inbox gets a security notice; a mail failure must not undo the
    # change the user already confirmed.
    try:
        send_email_changed_notice(old_email, old_email, new_email)
    except EmailDeliveryError:
        logger.warning("Email-change notice failed for user %s", user.id)

    return UserOut.model_validate(user)
