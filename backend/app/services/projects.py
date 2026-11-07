"""Database helpers for saved projects.

Routes stay thin: every query that must respect ownership lives here, so a
missing ``user_id`` filter cannot leak another account's map.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models.project import Project
from node_tree import count_nodes


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def summary(project: Project) -> dict[str, Any]:
    """What a list/card needs — never the transcript."""
    return {
        "id": project.id,
        "title": project.title,
        "video_id": project.video_id,
        "is_draft": project.is_draft,
        "visibility": project.visibility,
        "share_slug": project.share_slug,
        "link_role": project.link_role,
        # The tree is nested, so the top-level list is only the number of roots.
        "node_count": count_nodes(project.nodes or []),
        "transcript_language": project.transcript_language,
        "consumed_until": round(float(project.consumed_until or 0.0), 2),
        "created_at": _iso(project.created_at),
        "updated_at": _iso(project.updated_at),
        "last_opened_at": _iso(project.last_opened_at),
    }


def detail(project: Project) -> dict[str, Any]:
    return {
        **summary(project),
        "nodes": project.nodes or [],
        "transcript": project.transcript or [],
        "summary_so_far": project.summary_so_far or "",
    }


def get_owned(db: Session, user_id: str, project_id: str) -> Project | None:
    return db.scalar(
        select(Project).where(Project.id == project_id, Project.user_id == user_id)
    )


def list_projects(
    db: Session,
    user_id: str,
    *,
    is_draft: bool | None = None,
    query: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Project], int]:
    conditions = [Project.user_id == user_id]
    if is_draft is not None:
        conditions.append(Project.is_draft == is_draft)
    if query:
        pattern = f"%{query.strip()}%"
        conditions.append(
            or_(Project.title.ilike(pattern), Project.video_id.ilike(pattern))
        )

    total = db.scalar(select(func.count(Project.id)).where(*conditions)) or 0
    rows = db.scalars(
        select(Project)
        .where(*conditions)
        .order_by(Project.updated_at.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return list(rows), int(total)


def create(db: Session, user_id: str, data: dict[str, Any]) -> Project:
    project = Project(user_id=user_id, **data)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def update(db: Session, project: Project, data: dict[str, Any]) -> Project:
    for field, value in data.items():
        if value is not None:
            setattr(project, field, value)
    db.commit()
    db.refresh(project)
    return project


def delete(db: Session, project: Project) -> None:
    db.delete(project)
    db.commit()


def duplicate(db: Session, project: Project) -> Project:
    copy = Project(
        user_id=project.user_id,
        video_id=project.video_id,
        title=f"{project.title} (bản sao)",
        nodes=list(project.nodes or []),
        transcript=list(project.transcript or []),
        transcript_language=project.transcript_language,
        summary_so_far=project.summary_so_far or "",
        consumed_until=float(project.consumed_until or 0.0),
        is_draft=False,
        visibility="private",
        share_slug=None,
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return copy


def stats(db: Session, user_id: str) -> dict[str, Any]:
    saved = db.scalar(
        select(func.count(Project.id)).where(
            Project.user_id == user_id, Project.is_draft.is_(False)
        )
    ) or 0
    drafts = db.scalar(
        select(func.count(Project.id)).where(
            Project.user_id == user_id, Project.is_draft.is_(True)
        )
    ) or 0
    shared = db.scalar(
        select(func.count(Project.id)).where(
            Project.user_id == user_id, Project.visibility != "private"
        )
    ) or 0
    recent = db.scalars(
        select(Project)
        .where(Project.user_id == user_id, Project.is_draft.is_(False))
        .order_by(Project.updated_at.desc())
        .limit(5)
    ).all()
    return {
        "saved": int(saved),
        "drafts": int(drafts),
        "shared": int(shared),
        "recent": [summary(project) for project in recent],
    }


def save_session(
    db: Session,
    project: Project,
    session: dict[str, Any],
    *,
    title: str | None = None,
) -> Project:
    """Write the live session into an existing row.

    Shared editors use this directly: the row belongs to the owner, but the map
    fields are the session's. ``title`` is only honoured when the caller is the
    owner; a collaborator may never rename someone else's project.
    """

    if title:
        project.title = title
    project.nodes = session.get("nodes", [])
    project.transcript = session.get("transcript", [])
    project.transcript_language = session.get("language")
    project.summary_so_far = session.get("summary_so_far", "")
    project.consumed_until = float(session.get("consumed_until", 0.0))
    project.last_opened_at = utcnow()

    db.commit()
    db.refresh(project)
    session["project_id"] = project.id
    return project


def autosave(
    db: Session,
    user_id: str,
    session: dict[str, Any],
    *,
    project_id: str | None = None,
    title: str | None = None,
    is_draft: bool = True,
) -> Project | None:
    """Copy the live in-memory session into a row owned by ``user_id``.

    A saved project is never demoted back to a draft, and its title is only
    replaced when the caller explicitly sends one (the "save as" dialog).
    """

    project: Project | None = None

    if project_id:
        project = get_owned(db, user_id, project_id)
        if project is None:
            return None
    elif session.get("project_id"):
        project = get_owned(db, user_id, session["project_id"])

    if project is None and session.get("video_id"):
        # Reuse the newest draft for this video so opening it twice in one day
        # does not fill the drafts list with duplicates.
        project = db.scalar(
            select(Project)
            .where(
                Project.user_id == user_id,
                Project.video_id == session["video_id"],
                Project.is_draft.is_(True),
            )
            .order_by(Project.updated_at.desc())
        )

    if project is None:
        project = Project(
            user_id=user_id,
            video_id=session.get("video_id"),
            title=title or session.get("title") or "Sơ đồ chưa đặt tên",
            is_draft=is_draft,
        )
        db.add(project)
        db.flush()

    return save_session(db, project, session, title=title)
