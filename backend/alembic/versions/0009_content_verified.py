"""Layer-3 share policy: only confirmed lectures may be shared.

Adds ``projects.content_verified``, defaulting to false. Existing rows keep
their data but lose their public links until the video is confirmed again:
sharing must fail closed when the provenance of a video is unknown.

Revision ID: 0009_content_verified
Revises: 0008_map_style
Create Date: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009_content_verified"
down_revision: str | None = "0008_map_style"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "content_verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("projects", "content_verified")
