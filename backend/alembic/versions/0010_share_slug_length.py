"""Widen share links for high-entropy capabilities.

New share slugs carry 24 random bytes (~192 bits) instead of 8 characters from
a 36-character alphabet (~41 bits). Old links keep working: this migration only
widens the column so both shapes fit.

Revision ID: 0010_share_slug_length
Revises: 0009_content_verified
Create Date: 2026-11-26
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010_share_slug_length"
down_revision: str | None = "0009_content_verified"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Batch mode keeps the unique index intact on SQLite, where a plain column
    # change would otherwise require a table rebuild.
    with op.batch_alter_table("projects") as batch_op:
        batch_op.alter_column(
            "share_slug",
            existing_type=sa.String(length=24),
            type_=sa.String(length=64),
            existing_nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.alter_column(
            "share_slug",
            existing_type=sa.String(length=64),
            type_=sa.String(length=24),
            existing_nullable=True,
        )
