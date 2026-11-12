"""Request bodies for the saved-project endpoints."""

from typing import Any

from pydantic import BaseModel, Field

TITLE_FIELD = Field(min_length=1, max_length=200)
LAYOUT_FIELD = Field(default="tree", pattern="^(tree|tree-down|spider|bubble|circle)$")
PALETTE_FIELD = Field(default="paper", pattern="^(paper|sage|sky|blush|lilac|sand)$")


class ProjectCreate(BaseModel):
    title: str = TITLE_FIELD
    video_id: str | None = Field(default=None, max_length=11)
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    transcript: list[dict[str, Any]] = Field(default_factory=list)
    transcript_language: str | None = Field(default=None, max_length=20)
    summary_so_far: str = ""
    consumed_until: float = 0.0
    is_draft: bool = False
    tags: list[str] = Field(default_factory=list, max_length=8)
    map_layout: str = LAYOUT_FIELD
    map_palette: str = PALETTE_FIELD


class ProjectUpdate(BaseModel):
    """Every field is optional: only what the caller sends is written."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    nodes: list[dict[str, Any]] | None = None
    transcript: list[dict[str, Any]] | None = None
    transcript_language: str | None = Field(default=None, max_length=20)
    summary_so_far: str | None = None
    consumed_until: float | None = None
    is_draft: bool | None = None
    visibility: str | None = Field(default=None, pattern="^(private|unlisted)$")
    tags: list[str] | None = Field(default=None, max_length=8)
    map_layout: str | None = Field(
        default=None, pattern="^(tree|tree-down|spider|bubble|circle)$"
    )
    map_palette: str | None = Field(
        default=None, pattern="^(paper|sage|sky|blush|lilac|sand)$"
    )


class AutosaveRequest(BaseModel):
    """Written by the workspace while the user is signed in.

    The server copies the live session, so the browser never has to upload the
    transcript again — only a session id and (after the first save) a project id.
    """

    session_id: str
    project_id: str | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    is_draft: bool = True
    map_layout: str | None = Field(
        default=None, pattern="^(tree|tree-down|spider|bubble|circle)$"
    )
    map_palette: str | None = Field(
        default=None, pattern="^(paper|sage|sky|blush|lilac|sand)$"
    )
