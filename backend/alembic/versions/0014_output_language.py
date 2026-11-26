"""Add the learner's chosen mind-map language to projects.

``transcript_language`` stays the provenance of the captions. This new field is
the language the learner wants to study in. NULL means "follow the transcript
language", so every existing project and every cached guest map behaves exactly
as before until a language is chosen.

Revision ID: 0014_output_language
Revises: 0013_asr_fallback
Create Date: 2026-11-26
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0014_output_language"
down_revision: str | None = "0013_asr_fallback"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(sa.Column("output_language", sa.String(length=20), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("output_language")
