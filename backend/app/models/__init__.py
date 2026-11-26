"""Import every model here so Alembic autogenerate and metadata see them."""

from app.models.account_token import AccountToken
from app.models.project import Project
from app.models.project_member import ProjectMember
from app.models.project_version import ProjectVersion
from app.models.refresh_token import RefreshToken
from app.models.review_attempt import ReviewAttempt
from app.models.user import User
from app.models.video_transcript import VideoTranscript

__all__ = [
    "AccountToken",
    "Project",
    "ProjectMember",
    "ProjectVersion",
    "RefreshToken",
    "ReviewAttempt",
    "User",
    "VideoTranscript",
]
