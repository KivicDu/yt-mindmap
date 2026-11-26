"""Add the shared ASR transcript cache and the project's cue provenance.

ADR 0012: a completed audio transcript is a property of the video, so it is
stored once and reused by every learner. ``transcript_source`` lets the UI label
cues as YouTube captions, an upload, or audio transcribed by IVAN.

Revision ID: 0013_asr_fallback
Revises: 0012_self_check_review
Create Date: 2026-11-26
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0013_asr_fallback"
down_revision: str | None = "0012_self_check_review"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(
            sa.Column(
                "transcript_source",
                sa.String(length=20),
                server_default="youtube_auto",
                nullable=False,
            )
        )

    op.create_table(
        "video_transcripts",
        sa.Column("video_id", sa.String(length=11), primary_key=True),
        sa.Column("language", sa.String(length=20), nullable=True),
        sa.Column("cues", sa.JSON(), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="asr"),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("video_transcripts")
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("transcript_source")
