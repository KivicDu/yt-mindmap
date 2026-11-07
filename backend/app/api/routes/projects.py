"""Saved projects: list, open, rename, duplicate, delete.

Every route requires a signed-in user and filters by ``user_id`` in the same
query, so an id from another account is indistinguishable from a missing one.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.project import ProjectCreate, ProjectUpdate
from app.schemas.sharing import MemberCreate, MemberUpdate, ShareRotate, ShareUpdate
from app.services import projects as project_service
from app.services import sharing as sharing_service

router = APIRouter(prefix="/projects", tags=["projects"])

_NOT_FOUND = HTTPException(status_code=404, detail="project_not_found")


def _owned_or_404(db: Session, user: User, project_id: str):
    project = project_service.get_owned(db, user.id, project_id)
    if project is None:
        raise _NOT_FOUND
    return project


@router.get("")
def list_projects(
    draft: bool | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows, total = project_service.list_projects(
        db, user.id, is_draft=draft, query=q, limit=limit, offset=offset
    )
    return {
        "items": [project_service.summary(row) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/stats")
def project_stats(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stats = project_service.stats(db, user.id)
    stats["shared_with_me"] = sharing_service.count_shared_with_me(db, user)
    return stats


@router.get("/shared")
def shared_projects(
    q: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows, total = sharing_service.list_shared(
        db, user, query=q, limit=limit, offset=offset
    )
    return {
        "items": [
            {
                **project_service.summary(project),
                "role": role,
                "owner_name": owner_name,
            }
            for project, role, owner_name in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_project(
    body: ProjectCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = project_service.create(db, user.id, body.model_dump())
    return project_service.detail(project)


@router.get("/{project_id}")
def get_project(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return project_service.detail(_owned_or_404(db, user, project_id))


@router.patch("/{project_id}")
def update_project(
    project_id: str,
    body: ProjectUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _owned_or_404(db, user, project_id)
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="no_fields_to_update")
    return project_service.detail(
        project_service.update(db, project, changes)
    )


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project_service.delete(db, _owned_or_404(db, user, project_id))


@router.post("/{project_id}/duplicate", status_code=status.HTTP_201_CREATED)
def duplicate_project(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    copy = project_service.duplicate(db, _owned_or_404(db, user, project_id))
    return project_service.summary(copy)


@router.get("/{project_id}/share")
def get_share_settings(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _owned_or_404(db, user, project_id)
    return sharing_service.share_settings(db, project)


@router.put("/{project_id}/share")
def update_share_settings(
    project_id: str,
    body: ShareUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _owned_or_404(db, user, project_id)
    sharing_service.update_share(
        db,
        project,
        enabled=body.enabled,
        access=body.access,
        role=body.role,
    )
    return sharing_service.share_settings(db, project)


@router.post("/{project_id}/share/rotate")
def rotate_share_link(
    project_id: str,
    body: ShareRotate | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _owned_or_404(db, user, project_id)
    sharing_service.rotate_slug(db, project, role=body.role if body else None)
    return sharing_service.share_settings(db, project)


@router.get("/{project_id}/members")
def list_members(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _owned_or_404(db, user, project_id)
    return {
        "items": [
            sharing_service.member_payload(db, member)
            for member in sharing_service.list_members(db, project.id)
        ]
    }


@router.post("/{project_id}/members", status_code=status.HTTP_201_CREATED)
def add_member(
    project_id: str,
    body: MemberCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _owned_or_404(db, user, project_id)
    try:
        member = sharing_service.add_member(db, project, body.email, body.role)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return sharing_service.member_payload(db, member)


@router.patch("/{project_id}/members/{member_id}")
def update_member(
    project_id: str,
    member_id: str,
    body: MemberUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _owned_or_404(db, user, project_id)
    member = next(
        (
            item
            for item in sharing_service.list_members(db, project.id)
            if item.id == member_id
        ),
        None,
    )
    if member is None:
        raise HTTPException(status_code=404, detail="member_not_found")
    sharing_service.update_member(db, member, body.role)
    return sharing_service.member_payload(db, member)


@router.delete("/{project_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    project_id: str,
    member_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _owned_or_404(db, user, project_id)
    member = next(
        (
            item
            for item in sharing_service.list_members(db, project.id)
            if item.id == member_id
        ),
        None,
    )
    if member is None:
        raise HTTPException(status_code=404, detail="member_not_found")
    sharing_service.remove_member(db, member)
