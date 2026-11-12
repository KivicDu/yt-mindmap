"""Database helpers for saved projects.

Routes stay thin: every query that must respect ownership lives here, so a
missing ``user_id`` filter cannot leak another account's map.

Phase 8 adds three behaviours that all hinge on the same row:

* soft delete (``deleted_at``) so the dashboard can undo a delete;
* tags, stored as a JSON list and filtered with a portable text match;
* version snapshots of the map so an AI update can be rolled back.
"""

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import Text, cast, delete, func, or_, select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models.project import Project
from app.models.project_version import ProjectVersion
from app.utils.text import normalize_search_text, normalize_tag
from node_tree import count_nodes

TRASH_TTL_DAYS = 30
VERSION_LIMIT = 50
VERSION_MIN_SECONDS = 45
MAX_TAGS = 8


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _seconds_since(value: datetime) -> float:
    """SQLite returns naive datetimes even for timezone-aware columns."""
    moment = value if value.tzinfo else value.replace(tzinfo=UTC)
    return max(0.0, (utcnow() - moment).total_seconds())


def _iter_node_text(nodes: list[dict[str, Any]]):
    for node in nodes:
        label = node.get("label")
        if isinstance(label, str) and label:
            yield "node", label, node.get("time")
        note = node.get("note")
        if isinstance(note, str) and note:
            yield "note", note, node.get("time")
        children = node.get("children")
        if isinstance(children, list):
            yield from _iter_node_text(children)


def build_search_text(
    *,
    title: str,
    nodes: list[dict[str, Any]] | None,
    transcript: list[dict[str, Any]] | None,
    summary_so_far: str | None,
) -> str:
    parts = [title, summary_so_far or ""]
    parts.extend(text for _, text, _ in _iter_node_text(nodes or []))
    parts.extend(
        cue.get("text", "")
        for cue in (transcript or [])
        if isinstance(cue.get("text"), str)
    )
    return normalize_search_text(" ".join(parts))


def normalize_tags(values: list[str] | None) -> list[str]:
    """Trim, de-duplicate and cap tags while preserving the author's order."""
    if not values:
        return []
    seen: list[str] = []
    for value in values:
        tag = normalize_tag(str(value))
        if tag and tag not in seen:
            seen.append(tag)
        if len(seen) >= MAX_TAGS:
            break
    return seen


def apply_style(project: Project, layout: str | None, palette: str | None) -> bool:
    """Write a map style the schema already validated.

    Returns ``True`` when something changed, so the caller can decide whether
    the row needs a commit of its own.
    """

    changed = False
    if layout and layout != project.map_layout:
        project.map_layout = layout
        changed = True
    if palette and palette != project.map_palette:
        project.map_palette = palette
        changed = True
    return changed


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
        "tags": list(project.tags or []),
        "map_layout": project.map_layout or "tree",
        "map_palette": project.map_palette or "paper",
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


def get_owned(
    db: Session,
    user_id: str,
    project_id: str,
    *,
    include_deleted: bool = False,
) -> Project | None:
    conditions = [Project.id == project_id, Project.user_id == user_id]
    if not include_deleted:
        conditions.append(Project.deleted_at.is_(None))
    return db.scalar(select(Project).where(*conditions))


def backfill_search_text(db: Session, user_id: str) -> int:
    """Fill ``search_text`` for rows saved before phase 8.

    The migration cannot strip accents in SQL, so the first read that needs
    search repairs the caller's old rows once. Titles are never empty, which
    makes an empty column an unambiguous "not built yet" marker.
    """
    rows = db.scalars(
        select(Project).where(
            Project.user_id == user_id,
            Project.deleted_at.is_(None),
            Project.search_text == "",
        )
    ).all()
    for project in rows:
        project.search_text = build_search_text(
            title=project.title,
            nodes=project.nodes,
            transcript=project.transcript,
            summary_so_far=project.summary_so_far,
        )
    if rows:
        db.commit()
    return len(rows)


def list_projects(
    db: Session,
    user_id: str,
    *,
    is_draft: bool | None = None,
    query: str | None = None,
    tag: str | None = None,
    sort: str = "updated",
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Project], int]:
    conditions = [Project.user_id == user_id, Project.deleted_at.is_(None)]
    if is_draft is not None:
        conditions.append(Project.is_draft == is_draft)
    if query:
        backfill_search_text(db, user_id)
        pattern = f"%{normalize_search_text(query)}%"
        conditions.append(
            or_(
                Project.search_text.ilike(pattern),
                Project.title.ilike(f"%{query.strip()}%"),
                Project.video_id.ilike(f"%{query.strip()}%"),
            )
        )
    if tag:
        normalized = normalize_tag(tag)
        if normalized:
            conditions.append(
                cast(Project.tags, Text).ilike(f'%"{normalized}"%')
            )

    order = {
        "updated": Project.updated_at.desc(),
        "created": Project.created_at.desc(),
        "title": func.lower(Project.title).asc(),
    }.get(sort, Project.updated_at.desc())

    total = db.scalar(select(func.count(Project.id)).where(*conditions)) or 0
    rows = db.scalars(
        select(Project)
        .where(*conditions)
        .order_by(order, Project.id.asc())
        .offset(offset)
        .limit(limit)
    ).all()
    return list(rows), int(total)


def list_tags(db: Session, user_id: str) -> list[dict[str, Any]]:
    """Every tag the account uses, with how many projects carry it."""
    rows = db.scalars(
        select(Project.tags).where(
            Project.user_id == user_id, Project.deleted_at.is_(None)
        )
    ).all()
    counts: dict[str, int] = {}
    for tags in rows:
        for tag in tags or []:
            counts[tag] = counts.get(tag, 0) + 1
    return [
        {"tag": tag, "count": count}
        for tag, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]


def create(db: Session, user_id: str, data: dict[str, Any]) -> Project:
    payload = dict(data)
    payload["tags"] = normalize_tags(payload.get("tags"))
    payload["search_text"] = build_search_text(
        title=payload.get("title", ""),
        nodes=payload.get("nodes"),
        transcript=payload.get("transcript"),
        summary_so_far=payload.get("summary_so_far"),
    )
    project = Project(user_id=user_id, **payload)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def update(db: Session, project: Project, data: dict[str, Any]) -> Project:
    for field, value in data.items():
        if value is None:
            continue
        if field == "tags":
            setattr(project, field, normalize_tags(value))
        else:
            setattr(project, field, value)
    project.search_text = build_search_text(
        title=project.title,
        nodes=project.nodes,
        transcript=project.transcript,
        summary_so_far=project.summary_so_far,
    )
    db.commit()
    db.refresh(project)
    return project


def soft_delete(db: Session, project: Project) -> None:
    """Move a project to the trash and revoke any live share link."""
    project.deleted_at = utcnow()
    project.visibility = "private"
    project.share_slug = None
    db.commit()


def restore(db: Session, project: Project) -> Project:
    project.deleted_at = None
    db.commit()
    db.refresh(project)
    return project


def purge(db: Session, project: Project) -> None:
    db.delete(project)
    db.commit()


def purge_expired(db: Session, user_id: str) -> int:
    """Drop trashed projects older than the recovery window."""
    cutoff = utcnow() - timedelta(days=TRASH_TTL_DAYS)
    rows = db.scalars(
        select(Project).where(
            Project.user_id == user_id,
            Project.deleted_at.is_not(None),
            Project.deleted_at < cutoff,
        )
    ).all()
    for project in rows:
        db.delete(project)
    if rows:
        db.commit()
    return len(rows)


def list_trash(
    db: Session, user_id: str, *, limit: int = 50, offset: int = 0
) -> tuple[list[Project], int]:
    purge_expired(db, user_id)
    conditions = [Project.user_id == user_id, Project.deleted_at.is_not(None)]
    total = db.scalar(select(func.count(Project.id)).where(*conditions)) or 0
    rows = db.scalars(
        select(Project)
        .where(*conditions)
        .order_by(Project.deleted_at.desc(), Project.id.asc())
        .offset(offset)
        .limit(limit)
    ).all()
    return list(rows), int(total)


def trash_payload(project: Project) -> dict[str, Any]:
    """A trashed project, plus how long the owner still has to restore it."""
    deleted_at = project.deleted_at
    days_left = 0
    if deleted_at is not None:
        elapsed_days = int(_seconds_since(deleted_at) // 86400)
        days_left = max(0, TRASH_TTL_DAYS - elapsed_days)
    return {
        **summary(project),
        "deleted_at": _iso(deleted_at),
        "days_left": days_left,
    }


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
        tags=list(project.tags or []),
        map_layout=project.map_layout,
        map_palette=project.map_palette,
        search_text=project.search_text,
        visibility="private",
        share_slug=None,
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return copy


def stats(db: Session, user_id: str) -> dict[str, Any]:
    active = [Project.user_id == user_id, Project.deleted_at.is_(None)]
    saved = db.scalar(
        select(func.count(Project.id)).where(*active, Project.is_draft.is_(False))
    ) or 0
    drafts = db.scalar(
        select(func.count(Project.id)).where(*active, Project.is_draft.is_(True))
    ) or 0
    shared = db.scalar(
        select(func.count(Project.id)).where(*active, Project.visibility != "private")
    ) or 0
    trashed = db.scalar(
        select(func.count(Project.id)).where(
            Project.user_id == user_id, Project.deleted_at.is_not(None)
        )
    ) or 0
    recent = db.scalars(
        select(Project)
        .where(*active, Project.is_draft.is_(False))
        .order_by(Project.updated_at.desc())
        .limit(5)
    ).all()
    return {
        "saved": int(saved),
        "drafts": int(drafts),
        "shared": int(shared),
        "trashed": int(trashed),
        "recent": [summary(project) for project in recent],
    }


def save_session(
    db: Session,
    project: Project,
    session: dict[str, Any],
    *,
    title: str | None = None,
    author_id: str | None = None,
) -> Project:
    """Write the live session into an existing row.

    Shared editors use this directly: the row belongs to the owner, but the map
    fields are the session's. ``title`` is only honoured when the caller is the
    owner; a collaborator may never rename someone else's project.
    """

    # Keep the state before this write so a manual edit can also be undone.
    snapshot(db, project, author_id=author_id)

    if title:
        project.title = title
    project.nodes = session.get("nodes", [])
    project.transcript = session.get("transcript", [])
    project.transcript_language = session.get("language")
    project.summary_so_far = session.get("summary_so_far", "")
    project.consumed_until = float(session.get("consumed_until", 0.0))
    project.last_opened_at = utcnow()
    project.search_text = build_search_text(
        title=project.title,
        nodes=project.nodes,
        transcript=project.transcript,
        summary_so_far=project.summary_so_far,
    )

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
    map_layout: str | None = None,
    map_palette: str | None = None,
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
                Project.deleted_at.is_(None),
            )
            .order_by(Project.updated_at.desc())
        )

    if project is None:
        project = Project(
            user_id=user_id,
            video_id=session.get("video_id"),
            title=title or session.get("title") or "Sơ đồ chưa đặt tên",
            is_draft=is_draft,
            map_layout=map_layout or "tree",
            map_palette=map_palette or "paper",
        )
        db.add(project)
        db.flush()
    else:
        apply_style(project, map_layout, map_palette)

    return save_session(
        db,
        project,
        session,
        title=title,
        author_id=session.get("editor_id"),
    )


# ----------------------------------------------------------------------
# Version history
# ----------------------------------------------------------------------


def _nodes_signature(nodes: list[dict[str, Any]] | None) -> str:
    return json.dumps(nodes or [], sort_keys=True, ensure_ascii=False)


def snapshot(
    db: Session,
    project: Project,
    *,
    author_id: str | None = None,
    force: bool = False,
) -> ProjectVersion | None:
    """Store the current map unless the latest snapshot is identical/recent."""
    if not project.nodes:
        return None

    latest = db.scalar(
        select(ProjectVersion)
        .where(ProjectVersion.project_id == project.id)
        .order_by(ProjectVersion.created_at.desc())
        .limit(1)
    )
    if latest is not None:
        if _nodes_signature(latest.nodes) == _nodes_signature(project.nodes):
            return None
        if not force and _seconds_since(latest.created_at) < VERSION_MIN_SECONDS:
            return None

    version = ProjectVersion(
        project_id=project.id,
        author_id=author_id,
        title=project.title,
        nodes=project.nodes,
        summary_so_far=project.summary_so_far or "",
        consumed_until=float(project.consumed_until or 0.0),
    )
    db.add(version)
    db.flush()

    stale = db.scalars(
        select(ProjectVersion.id)
        .where(ProjectVersion.project_id == project.id)
        .order_by(ProjectVersion.created_at.desc())
        .offset(VERSION_LIMIT)
    ).all()
    if stale:
        db.execute(delete(ProjectVersion).where(ProjectVersion.id.in_(stale)))

    db.commit()
    return version


def version_payload(version: ProjectVersion, *, with_nodes: bool = False) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": version.id,
        "title": version.title,
        "node_count": count_nodes(version.nodes or []),
        "consumed_until": round(float(version.consumed_until or 0.0), 2),
        "summary": (version.summary_so_far or "")[:280],
        "created_at": _iso(version.created_at),
    }
    if with_nodes:
        payload["nodes"] = version.nodes or []
        payload["summary_so_far"] = version.summary_so_far or ""
    return payload


def list_versions(db: Session, project_id: str) -> list[ProjectVersion]:
    return list(
        db.scalars(
            select(ProjectVersion)
            .where(ProjectVersion.project_id == project_id)
            .order_by(ProjectVersion.created_at.desc())
        )
    )


def get_version(
    db: Session, project_id: str, version_id: str
) -> ProjectVersion | None:
    return db.scalar(
        select(ProjectVersion).where(
            ProjectVersion.id == version_id,
            ProjectVersion.project_id == project_id,
        )
    )


def restore_version(
    db: Session,
    project: Project,
    version: ProjectVersion,
    *,
    author_id: str | None = None,
) -> Project:
    """Put a snapshot back into the project, keeping the replaced state too."""
    snapshot(db, project, author_id=author_id, force=True)

    project.nodes = list(version.nodes or [])
    project.summary_so_far = version.summary_so_far or ""
    project.consumed_until = float(version.consumed_until or 0.0)
    project.last_opened_at = utcnow()
    project.search_text = build_search_text(
        title=project.title,
        nodes=project.nodes,
        transcript=project.transcript,
        summary_so_far=project.summary_so_far,
    )
    db.commit()
    db.refresh(project)
    return project


# ----------------------------------------------------------------------
# Content search
# ----------------------------------------------------------------------


def _snippet(text: str, needle: str, *, size: int = 150) -> str:
    normalized = normalize_search_text(text)
    index = normalized.find(needle)
    if index < 0:
        return text[:size] + ("…" if len(text) > size else "")
    # Map the match position back to the original (accented) string.
    position = int(index * len(text) / max(1, len(normalized)))
    start = max(0, position - 45)
    end = min(len(text), start + size)
    snippet = text[start:end].strip()
    return f"…{snippet}" if start > 0 else snippet


def _find_matches(project: Project, needle: str) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []

    def add(kind: str, text: str, time: float | None = None) -> None:
        if needle in normalize_search_text(text):
            matches.append(
                {
                    "kind": kind,
                    "text": _snippet(text, needle),
                    "time": round(float(time), 2) if time is not None else None,
                }
            )

    add("title", project.title)
    for kind, text, time in _iter_node_text(project.nodes or []):
        add(kind, text, time)
    add("summary", project.summary_so_far or "")
    for cue in project.transcript or []:
        text = cue.get("text")
        if isinstance(text, str):
            add("transcript", text, cue.get("start"))
    return matches


def search(
    db: Session, user_id: str, query: str, *, limit: int = 50
) -> list[dict[str, Any]]:
    """Projects whose title, map, notes, summary or transcript match."""
    needle = normalize_search_text(query)
    if not needle:
        return []

    backfill_search_text(db, user_id)
    pattern = f"%{needle}%"
    rows = db.scalars(
        select(Project)
        .where(
            Project.user_id == user_id,
            Project.deleted_at.is_(None),
            Project.search_text.ilike(pattern),
        )
        .order_by(Project.updated_at.desc())
        .limit(limit)
    ).all()

    results = []
    for project in rows:
        matches = _find_matches(project, needle)
        results.append(
            {
                **summary(project),
                "match_count": len(matches),
                "matches": matches[:4],
            }
        )
    return results
