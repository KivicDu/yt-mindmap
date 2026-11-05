"""Account lookup and creation for OAuth sign-ins.

Policy (agreed for phase 1): signing in with Google or GitHub using an email
that already belongs to a password account links the two instead of creating a
second account. Google and GitHub only report verified addresses, so the linkage
proves ownership of the email. The password stays valid and keeps working.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models.user import User
from app.services.oauth import OAuthIdentity


def normalize_email(email: str) -> str:
    return email.strip().lower()


def upsert_oauth_user(db: Session, identity: OAuthIdentity) -> User:
    """Find or create the account behind one OAuth profile."""
    email = normalize_email(identity.email)
    linked_key = f"{identity.provider}:{identity.provider_id}"

    user = db.scalar(select(User).where(User.provider_id == linked_key))
    if user is None:
        user = db.scalar(select(User).where(User.email == email))

    if user is None:
        user = User(
            email=email,
            display_name=identity.display_name.strip() or email.split("@")[0],
            password_hash=None,
            provider=identity.provider,
            provider_id=linked_key,
            avatar_url=identity.avatar_url,
            email_verified=identity.email_verified,
        )
        db.add(user)
    else:
        # Auto-link. Keep the original email (it is the account's identity) and
        # only fill in what is still missing.
        if not user.provider_id:
            user.provider_id = linked_key
        if user.password_hash is None:
            user.provider = identity.provider
        if not user.avatar_url and identity.avatar_url:
            user.avatar_url = identity.avatar_url
        if identity.email_verified:
            user.email_verified = True

    user.last_login_at = utcnow()
    db.commit()
    db.refresh(user)
    return user
