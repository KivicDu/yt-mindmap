"""Public entry point for a shared map.

A slug is a capability, but a capability alone is not always enough: an
``invited`` project still checks the signed-in email. The response carries the
role so the SPA can render a read-only map or offer the workspace.
"""

import html
import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_optional_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models.user import User
from app.services import projects as project_service
from app.services import sharing as sharing_service

router = APIRouter(prefix="/share", tags=["share"])

GENERIC_SHARE_TITLE = "Sơ đồ tư duy được chia sẻ | yt-mindmap"
GENERIC_SHARE_DESCRIPTION = (
    "Xem sơ đồ tư duy và nội dung học tập được chia sẻ bằng yt-mindmap."
)


@router.get("/meta", response_class=Response, include_in_schema=False)
def shared_project_metadata(
    slug: str,
    db: Session = Depends(get_db),
) -> Response:
    """Render safe social metadata for public share URLs during nginx SSI."""
    project = sharing_service.get_by_slug(db, slug)
    if project and project.visibility == "unlisted":
        title = f"{project.title} — sơ đồ tư duy | yt-mindmap"
        description = f"Xem sơ đồ tư duy “{project.title}” được chia sẻ bằng yt-mindmap."
    else:
        title = GENERIC_SHARE_TITLE
        description = GENERIC_SHARE_DESCRIPTION

    frontend_url = get_settings().FRONTEND_URL.rstrip("/")
    share_url = f"{frontend_url}/s/{quote(slug, safe='')}"
    tags = [
        f'<title>{html.escape(title)}</title>',
        f'<meta name="description" content="{html.escape(description, quote=True)}">',
        '<meta name="robots" content="noindex,nofollow">',
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="yt-mindmap">',
        f'<meta property="og:title" content="{html.escape(title, quote=True)}">',
        f'<meta property="og:description" content="{html.escape(description, quote=True)}">',
        f'<meta property="og:url" content="{html.escape(share_url, quote=True)}">',
    ]

    if project and project.visibility == "unlisted" and re.fullmatch(
        r"[A-Za-z0-9_-]{11}", project.video_id or ""
    ):
        thumbnail_url = (
            f"https://i.ytimg.com/vi/{project.video_id}/hqdefault.jpg"
        )
        tags.append(
            f'<meta property="og:image" content="{html.escape(thumbnail_url, quote=True)}">'
        )

    return Response(content="\n".join(tags), media_type="text/html")


@router.get("/{slug}")
def read_shared_project(
    slug: str,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    project = sharing_service.get_by_slug(db, slug)
    if project is None or project.visibility == "private":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "share_not_found",
                "message": "This share link does not exist or has been turned off.",
            },
        )

    role = sharing_service.role_for(db, project, user)
    if role is None:
        if project.visibility == "invited":
            if user is None:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail={
                        "code": "share_login_required",
                        "message": "Sign in with the invited email to open this project.",
                    },
                )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "share_not_invited",
                    "message": "This account has not been invited to the project.",
                },
            )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "share_not_found",
                "message": "This share link does not exist or has been turned off.",
            },
        )

    owner = db.get(User, project.user_id)
    session_id = None
    # Imported lazily: main.py mounts the API router, so a module-level import
    # would be circular.
    try:
        from main import find_project_session

        session_id = find_project_session(project.id)
    except Exception:  # pragma: no cover - only possible during app shutdown
        session_id = None

    return {
        "project": project_service.detail(project),
        "role": role,
        "can_edit": user is not None and sharing_service.can_edit(role),
        "requires_login": user is None and project.visibility == "invited",
        "owner_name": owner.display_name if owner else "Chủ dự án",
        "session_id": session_id,
    }
