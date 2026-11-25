"""Add self-check attempts and the opt-in review schedule (ADR 0014).

``projects.next_review_at`` is NULL by default: NULL means "no reminder", so a
learner who never opts in sees no new dashboard UI. Attempts are countable
fractions (asked/correct), never a weighted percentage.

Revision ID: 0012_self_check_review
Revises: 0011_refresh_token_family
Create Date: 2026-11-26
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0012_self_check_review"
down_revision: str | None = "0011_refresh_token_family"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(sa.Column("next_review_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "review_attempts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(length=36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("asked", sa.Integer, nullable=False),
        sa.Column("correct", sa.Integer, nullable=False),
        sa.Column("overridden", sa.Integer, nullable=False, server_default="0"),
        sa.Column("weak_ranges", sa.JSON, nullable=False, server_default="[]"),
        # Per-question verdicts and the answer key, so the learner can see what
        # they missed and override a bad AI mark after the fact.
        sa.Column("items", sa.JSON, nullable=False, server_default="[]"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index(
        "ix_review_attempts_project_user",
        "review_attempts",
        ["project_id", "user_id"],
        unique=False,
    )
    op.create_index(
        "ix_review_attempts_due",
        "review_attempts",
        ["user_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_review_attempts_due", table_name="review_attempts")
    op.drop_index("ix_review_attempts_project_user", table_name="review_attempts")
    op.drop_table("review_attempts")
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("next_review_at")
