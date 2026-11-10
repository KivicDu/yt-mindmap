"""Phase 8: soft delete, tags and map version history.

* ``projects.deleted_at`` turns a delete into a move to the trash, so the
  dashboard can offer undo and a 30-day recovery window.
* ``projects.tags`` groups projects without a second table; tags are short,
  normalized strings and are filtered with a portable text match.
* ``project_versions`` keeps map snapshots so an AI update that derails the
  lesson can be rolled back.

Revision ID: 0007_learning_phase_8
Revises: 0006_account_recovery
Create Date: 2026-11-09
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_learning_phase_8"
down_revision: str | None = "0006_account_recovery"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("tags", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "projects",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("search_text", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("ix_projects_deleted_at", "projects", ["deleted_at"], unique=False)
    op.alter_column("projects", "tags", server_default=None)
    op.alter_column("projects", "search_text", server_default=None)

    op.create_table(
        "project_versions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("author_id", sa.String(length=36), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("nodes", sa.JSON(), nullable=False),
        sa.Column("summary_so_far", sa.Text(), nullable=False),
        sa.Column("consumed_until", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_project_versions_project_id",
        "project_versions",
        ["project_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_project_versions_project_id", table_name="project_versions")
    op.drop_table("project_versions")
    op.drop_index("ix_projects_deleted_at", table_name="projects")
    op.drop_column("projects", "search_text")
    op.drop_column("projects", "deleted_at")
    op.drop_column("projects", "tags")
