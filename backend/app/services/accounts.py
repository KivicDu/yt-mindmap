"""Account lookup and creation for OAuth sign-ins.

Policy (agreed for phase 1): signing in with Google or GitHub using an email
that already belongs to a password account links the two instead of creating a
second account. Google and GitHub only report verified addresses, so the linkage
proves ownership of the email. The password stays valid and keeps working.
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
