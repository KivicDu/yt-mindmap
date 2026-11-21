"""Phase 9: the learner picks the map's layout and palette up front.

* ``projects.map_layout`` chooses the renderer: ``tree`` (the markmap
  left-to-right tree) or one of the radial families ``spider``, ``bubble`` and
  ``circle``.
* ``projects.map_palette`` chooses the pastel branch colours.

Both are short allowlisted strings with defaults, so rows saved before this
migration keep rendering exactly as they did.

Revision ID: 0008_map_style
Revises: 0007_learning_phase_8
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008_map_style"
down_revision: str | None = "0007_learning_phase_8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "map_layout", sa.String(length=20), nullable=False, server_default="tree"
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "map_palette", sa.String(length=20), nullable=False, server_default="paper"
        ),
    )


def downgrade() -> None:
    op.drop_column("projects", "map_palette")
    op.drop_column("projects", "map_layout")
