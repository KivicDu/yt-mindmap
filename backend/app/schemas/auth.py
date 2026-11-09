"""Auth request/response bodies.

Passwords are capped at 72 bytes because that is all bcrypt reads; anything
longer is rejected up front instead of being silently truncated.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

PASSWORD_FIELD = Field(min_length=8, max_length=72)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = PASSWORD_FIELD
    display_name: str = Field(min_length=1, max_length=80)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    display_name: str
    provider: str
    avatar_url: str | None = None
    email_verified: bool
    created_at: datetime


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class AccessTokenResponse(BaseModel):
    """Returned by /auth/refresh: a new access token, no user payload."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UpdateProfileRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=72)
    new_password: str = PASSWORD_FIELD


class VerifyEmailRequest(BaseModel):
    token: str = Field(min_length=1, max_length=128)


class VerificationRequestResponse(BaseModel):
    status: Literal["sent", "already_verified"]
    # Only populated when DEBUG_EMAIL_LINKS is on (local development).
    dev_link: str | None = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=1, max_length=128)
    new_password: str = PASSWORD_FIELD


class EmailChangeRequest(BaseModel):
    new_email: EmailStr
    # Required for password accounts; OAuth-only accounts have no password.
    current_password: str | None = Field(default=None, max_length=72)


class ConfirmEmailChangeRequest(BaseModel):
    token: str = Field(min_length=1, max_length=128)


class DeleteAccountRequest(BaseModel):
    """Irreversible: the typed email must match the account being deleted."""

    confirm_email: EmailStr
    # Required for password accounts; OAuth-only accounts have no password.
    password: str | None = Field(default=None, max_length=72)


class ActionResponse(BaseModel):
    """Generic answer that never reveals whether an address has an account."""

    status: Literal["sent"]


class EmailChangeRequestResponse(BaseModel):
    status: Literal["sent", "unchanged"]
    # Only populated when DEBUG_EMAIL_LINKS is on (local development).
    dev_link: str | None = None
