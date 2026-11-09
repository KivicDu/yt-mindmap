"""Sharing rules: link capabilities, per-email membership and access checks.

The project owner is never stored in ``project_members``. A project can be in
one of three states:

* ``private``  — the owner only; no slug is kept.
* ``unlisted`` — anyone with the slug gets ``link_role``.
* ``invited``  — only addresses in ``project_members`` get their member role.

Editing always needs a signed-in user; an anonymous caller can only read a
public link. That keeps the "xem bằng link, sửa thì phải đăng nhập" rule close
to the data instead of relying on the UI.
"""

import secrets
import string
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.project_member import ProjectMember
from app.models.user import User

SLUG_ALPHABET = string.ascii_uppercase + string.digits
SLUG_LENGTH = 8
SLUG_PREFIX = "YTMM-"

ROLE_OWNER = "owner"
ROLE_EDITOR = "editor"
ROLE_VIEWER = "viewer"
EDITOR_ROLES = {ROLE_OWNER, ROLE_EDITOR}


def normalize_email(email: str) -> str:
    return email.strip().lower()


def can_edit(role: str | None) -> bool:
    return role in EDITOR_ROLES


def _new_slug() -> str:
    body = "".join(secrets.choice(SLUG_ALPHABET) for _ in range(SLUG_LENGTH))
    return f"{SLUG_PREFIX}{body}"


def unique_slug(db: Session) -> str:
    for _ in range(8):
        slug = _new_slug()
        if db.scalar(select(Project.id).where(Project.share_slug == slug)) is None:
            return slug
    # This is practically unreachable (36^8 values); fail loudly if it happens.
    raise RuntimeError("could_not_allocate_share_slug")


def get_by_slug(db: Session, slug: str) -> Project | None:
    return db.scalar(select(Project).where(Project.share_slug == slug))


def member_for(db: Session, project_id: str, email: str | None) -> ProjectMember | None:
    if not email:
        return None
    return db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.email == normalize_email(email),
        )
    )


def role_for(db: Session, project: Project, user: User | None) -> str | None:
    """The caller's effective role, or None when the project is not visible."""
    if user is not None and project.user_id == user.id:
        return ROLE_OWNER
    if project.visibility == "private":
        return None
    if user is not None:
        member = member_for(db, project.id, user.email)
        if member is not None:
            return member.role
    if project.visibility == "unlisted" and project.share_slug:
        return project.link_role
    return None


def role_for_anonymous(project: Project) -> str | None:
    """What a visitor without an account gets from a public link."""
    if project.visibility == "unlisted" and project.share_slug:
        return project.link_role
    return None


def member_payload(db: Session, member: ProjectMember) -> dict[str, Any]:
    registered = db.scalar(select(User.id).where(User.email == member.email))
    return {
        "id": member.id,
        "email": member.email,
        "role": member.role,
        "registered": registered is not None,
        "created_at": member.created_at.isoformat() if member.created_at else None,
    }


def list_members(db: Session, project_id: str) -> list[ProjectMember]:
    return list(
        db.scalars(
            select(ProjectMember)
            .where(ProjectMember.project_id == project_id)
            .order_by(ProjectMember.created_at.asc())
        )
    )


def share_settings(db: Session, project: Project) -> dict[str, Any]:
    members = list_members(db, project.id)
    enabled = project.visibility != "private" and project.share_slug is not None

    # What the link grants when access is "anyone"; invite-only links ignore it
    # because each member carries a role of their own.
    access = "invited" if project.visibility == "invited" else "anyone"

    return {
        "enabled": enabled,
        "access": access,
        "role": project.link_role,
        "slug": project.share_slug,
        "visibility": project.visibility,
        "members": [member_payload(db, member) for member in members],
    }


def update_share(
    db: Session,
    project: Project,
    *,
    enabled: bool,
    access: str,
    role: str,
) -> Project:
    if not enabled:
        project.visibility = "private"
        project.share_slug = None
        db.commit()
        db.refresh(project)
        return project

    if project.share_slug is None:
        project.share_slug = unique_slug(db)
    project.visibility = "invited" if access == "invited" else "unlisted"
    project.link_role = role
    db.commit()
    db.refresh(project)
    return project


def rotate_slug(db: Session, project: Project, role: str | None = None) -> Project:
    if project.visibility == "private":
        project.visibility = "unlisted"
    project.share_slug = unique_slug(db)
    if role is not None:
        project.link_role = role
    db.commit()
    db.refresh(project)
    return project


def add_member(
    db: Session, project: Project, email: str, role: str
) -> ProjectMember:
    email = normalize_email(email)
    owner = db.get(User, project.user_id)
    if owner is not None and owner.email == email:
        raise ValueError("cannot_invite_owner")

    member = member_for(db, project.id, email)
    if member is None:
        member = ProjectMember(project_id=project.id, email=email, role=role)
        db.add(member)
    else:
        member.role = role
    db.commit()
    db.refresh(member)
    return member


def update_member(db: Session, member: ProjectMember, role: str) -> ProjectMember:
    member.role = role
    db.commit()
    db.refresh(member)
    return member


def remove_member(db: Session, member: ProjectMember) -> None:
    db.delete(member)
    db.commit()


def list_shared(
    db: Session,
    user: User,
    *,
    query: str | None = None,
    sort: str = "updated",
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[tuple[Project, str, str]], int]:
    """Projects where ``user.email`` is a member, newest first."""
    conditions = [
        ProjectMember.email == normalize_email(user.email),
        Project.visibility != "private",
    ]
    if query:
        pattern = f"%{query.strip()}%"
        conditions.append(
            or_(Project.title.ilike(pattern), Project.video_id.ilike(pattern))
        )

    order = {
        "updated": Project.updated_at.desc(),
        "created": Project.created_at.desc(),
        "title": func.lower(Project.title).asc(),
    }.get(sort, Project.updated_at.desc())

    total = db.scalar(
        select(func.count(Project.id))
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(*conditions)
    ) or 0
    rows = db.execute(
        select(Project, ProjectMember.role, User.display_name)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .join(User, User.id == Project.user_id)
        .where(*conditions)
        .order_by(order, Project.id.asc())
        .offset(offset)
        .limit(limit)
    ).all()
    return [(project, role, owner_name) for project, role, owner_name in rows], int(total)


def count_shared_with_me(db: Session, user: User) -> int:
    return int(
        db.scalar(
            select(func.count(Project.id))
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(
                ProjectMember.email == normalize_email(user.email),
                Project.visibility != "private",
            )
        )
        or 0
    )
