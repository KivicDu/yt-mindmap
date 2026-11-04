"""Auth request/response bodies.

Passwords are capped at 72 bytes because that is all bcrypt reads; anything
longer is rejected up front instead of being silently truncated.
"""

from datetime import datetime

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
