"""Request bodies for sharing a project with a link or invited emails."""

from typing import Literal

from pydantic import BaseModel, EmailStr, Field

ShareRole = Literal["viewer", "editor"]
ShareAccess = Literal["anyone", "invited"]


class ShareUpdate(BaseModel):
    """Owner-side switch for the share link.

    ``enabled=False`` turns sharing off and clears the slug, so every old link
    stops working. Re-enabling always creates a fresh slug.
    """

    enabled: bool = True
    access: ShareAccess = "anyone"
    role: ShareRole = "viewer"


class MemberCreate(BaseModel):
    email: EmailStr
    role: ShareRole = "viewer"


class MemberUpdate(BaseModel):
    role: ShareRole


class ShareRotate(BaseModel):
    """Optional body for rotating; kept explicit so the intent is obvious."""

    role: ShareRole | None = Field(default=None)
