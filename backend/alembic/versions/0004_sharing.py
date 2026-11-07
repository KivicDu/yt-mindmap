"""share projects with a link or invited emails

A shared project needs three things beyond the reserved columns:
``projects.link_role`` (what the link itself grants), a membership table keyed
by email, and a visibility value for invite-only links. ``private`` still means
"owner only", ``unlisted`` means "anyone with the link" and ``invited`` means
"only the addresses in project_members".

Revision ID: 0004_sharing
Revises: 0003_projects
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_sharing"
down_revision: str | None = "0003_projects"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "link_role",
            sa.String(length=20),
            nullable=False,
            server_default="viewer",
        ),
    )

    op.create_table(
        "project_members",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id", "email", name="uq_project_members_project_email"
        ),
    )
    op.create_index(
        "ix_project_members_project_id", "project_members", ["project_id"], unique=False
    )
    op.create_index("ix_project_members_email", "project_members", ["email"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_project_members_email", table_name="project_members")
    op.drop_index("ix_project_members_project_id", table_name="project_members")
    op.drop_table("project_members")
    op.drop_column("projects", "link_role")
