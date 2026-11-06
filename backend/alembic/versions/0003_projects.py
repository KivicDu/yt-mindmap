"""create projects table

A project is one video (or one uploaded subtitle file) and its mind map. The
row stores the transcript and the AI summary as well, so reopening a project
does not depend on YouTube still serving the captions.

``visibility`` and ``share_slug`` are written now, before phase 3 needs them,
so sharing later is a route + UI change instead of another table migration.

Revision ID: 0003_projects
Revises: 0002_provider_id_unique
Create Date: 2026-11-06
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003_projects"
down_revision: str | None = "0002_provider_id_unique"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("video_id", sa.String(length=11), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("nodes", sa.JSON(), nullable=False),
        sa.Column("transcript", sa.JSON(), nullable=False),
        sa.Column("transcript_language", sa.String(length=20), nullable=True),
        sa.Column("summary_so_far", sa.Text(), nullable=False),
        sa.Column("consumed_until", sa.Float(), nullable=False),
        sa.Column("is_draft", sa.Boolean(), nullable=False),
        sa.Column("visibility", sa.String(length=20), nullable=False),
        sa.Column("share_slug", sa.String(length=24), nullable=True),
        sa.Column("last_opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_projects_user_id", "projects", ["user_id"], unique=False)
    op.create_index("ix_projects_video_id", "projects", ["video_id"], unique=False)
    op.create_index("ix_projects_share_slug", "projects", ["share_slug"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_projects_share_slug", table_name="projects")
    op.drop_index("ix_projects_video_id", table_name="projects")
    op.drop_index("ix_projects_user_id", table_name="projects")
    op.drop_table("projects")
