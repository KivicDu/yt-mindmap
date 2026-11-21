"""Account lookup and creation for OAuth sign-ins.

Policy: signing in with Google or GitHub using an email that already belongs
to a **verified** account links the two instead of creating a second account;
the password stays valid and keeps working.

An unverified local account with a password is never auto-linked. Registration
does not require inbox ownership, so anyone could register the victim's address
first and wait for the victim's first OAuth login to hand the account over. The
provider verifying its own email does not help: the local account was never
verified. In that case the callback returns a conflict the UI can explain.
"""

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models.account_token import AccountToken
from app.models.project import Project
from app.models.project_member import ProjectMember
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.services.oauth import OAuthIdentity


class OAuthLinkBlocked(Exception):
    """A provider identity would take over an unverified local account."""

    code = "oauth_email_conflict"


def normalize_email(email: str) -> str:
    return email.strip().lower()


def upsert_oauth_user(db: Session, identity: OAuthIdentity) -> User:
    """Find or create the account behind one OAuth profile."""
    email = normalize_email(identity.email)
    linked_key = f"{identity.provider}:{identity.provider_id}"

    user = db.scalar(select(User).where(User.provider_id == linked_key))
    if user is None:
        user = db.scalar(select(User).where(User.email == email))
        # An unverified password account proves nothing about inbox ownership.
        # Linking here would give whoever set that password control of the
        # provider-verified user's data. Verified accounts may still be linked.
        if (
            user is not None
            and user.password_hash is not None
            and not user.email_verified
        ):
            raise OAuthLinkBlocked(f"{email}: unverified local account exists")

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


def purge_account(db: Session, user: User) -> str:
    """Hard-delete one account and everything that belongs to it.

    Rows are removed explicitly instead of relying on ``ON DELETE CASCADE``
    alone: SQLite (used by the tests) does not enforce foreign keys by default,
    and ``project_members`` is keyed by email, so invitations sent to this
    address in *other* people's projects must go too.

    Returns the email address so the caller can send a final notice after the
    transaction commits.
    """
    email = user.email
    owned_project_ids = select(Project.id).where(Project.user_id == user.id)

    db.execute(
        delete(ProjectMember).where(
            or_(
                ProjectMember.project_id.in_(owned_project_ids),
                ProjectMember.email == email,
            )
        )
    )
    db.execute(delete(Project).where(Project.user_id == user.id))
    db.execute(delete(AccountToken).where(AccountToken.user_id == user.id))
    db.execute(delete(RefreshToken).where(RefreshToken.user_id == user.id))
    db.execute(delete(User).where(User.id == user.id))
    db.commit()
    return email
