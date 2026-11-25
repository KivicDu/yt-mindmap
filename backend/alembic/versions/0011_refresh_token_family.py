"""Group refresh-token rotations into revocable families.

Rotation already marks the consumed row as revoked, but a stolen cookie replayed
before the real client refreshes can mint a new token for the attacker. Keeping
a family id on every row lets a replay revoke the whole chain instead of just
the token that was replayed.

Revision ID: 0011_refresh_token_family
Revises: 0010_share_slug_length
Create Date: 2026-11-26
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011_refresh_token_family"
down_revision: str | None = "0010_share_slug_length"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable: tokens issued before this migration have no `fam` claim and
    # remain usable until expiry. Their replays revoke the NULL family.
    with op.batch_alter_table("refresh_tokens") as batch_op:
        batch_op.add_column(sa.Column("family_id", sa.String(length=32), nullable=True))
        batch_op.create_index(
            "ix_refresh_tokens_family_id", ["family_id"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("refresh_tokens") as batch_op:
        batch_op.drop_index("ix_refresh_tokens_family_id")
        batch_op.drop_column("family_id")
