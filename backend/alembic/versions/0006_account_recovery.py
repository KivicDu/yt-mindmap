"""account tokens for password reset and email change

Phase 4 stored verification tokens in ``email_verification_tokens``. Phase 5
needs the same lifecycle for password resets and email changes, so the table is
renamed to ``account_tokens`` and gains a ``purpose`` column plus the target
address for an email change.

Revision ID: 0006_account_recovery
Revises: 0005_account_security
Create Date: 2026-11-08
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006_account_recovery"
down_revision: str | None = "0005_account_security"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.rename_table("email_verification_tokens", "account_tokens")
    op.execute(
        "ALTER INDEX ix_email_verification_tokens_user_id "
        "RENAME TO ix_account_tokens_user_id"
    )
    op.execute(
        "ALTER INDEX ix_email_verification_tokens_token_hash "
        "RENAME TO ix_account_tokens_token_hash"
    )

    op.add_column(
        "account_tokens",
        sa.Column(
            "purpose",
            sa.String(length=32),
            nullable=False,
            server_default="verify_email",
        ),
    )
    op.add_column(
        "account_tokens",
        sa.Column("email", sa.String(length=320), nullable=True),
    )

    # Phase 4 allowed only one row per user in practice, but clean up before
    # enforcing it so the migration is safe on a database that raced.
    op.execute(
        "DELETE FROM account_tokens a USING account_tokens b "
        "WHERE a.user_id = b.user_id "
        "AND (a.created_at, a.id) < (b.created_at, b.id)"
    )
    op.create_unique_constraint(
        "uq_account_tokens_user_purpose",
        "account_tokens",
        ["user_id", "purpose"],
    )
    op.create_index(
        "ix_account_tokens_purpose",
        "account_tokens",
        ["purpose"],
        unique=False,
    )
    op.alter_column("account_tokens", "purpose", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_account_tokens_purpose", table_name="account_tokens")
    op.drop_constraint(
        "uq_account_tokens_user_purpose",
        "account_tokens",
        type_="unique",
    )
    op.drop_column("account_tokens", "email")
    op.drop_column("account_tokens", "purpose")
    op.execute(
        "ALTER INDEX ix_account_tokens_token_hash "
        "RENAME TO ix_email_verification_tokens_token_hash"
    )
    op.execute(
        "ALTER INDEX ix_account_tokens_user_id "
        "RENAME TO ix_email_verification_tokens_user_id"
    )
    op.rename_table("account_tokens", "email_verification_tokens")
