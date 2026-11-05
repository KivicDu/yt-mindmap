"""unique provider_id

An OAuth identity ("google:<sub>", "github:<id>") maps to exactly one account,
so the index behind it must be unique. PostgreSQL allows any number of NULLs in
a unique index, which is what local password accounts have.

Revision ID: 0002_provider_id_unique
Revises: 0001_users
Create Date: 2026-11-05
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002_provider_id_unique"
down_revision: str | None = "0001_users"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_users_provider_id", table_name="users")
    op.create_index(
        "ix_users_provider_id", "users", ["provider_id"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_users_provider_id", table_name="users")
    op.create_index(
        "ix_users_provider_id", "users", ["provider_id"], unique=False
    )
