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
from app.services import projects as project_service

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
    return project_service.stats(db, user.id)


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
