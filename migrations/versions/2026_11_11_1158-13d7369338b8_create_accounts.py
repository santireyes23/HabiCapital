"""create accounts

Revision ID: 13d7369338b8
Revises:
Create Date: 2026-11-11 11:58:17.472091

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "13d7369338b8"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_name", sa.String(length=100), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("token_rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "char_length(token_hash) = 64", name=op.f("ck_accounts_token_hash_is_sha256_hex")
        ),
        sa.CheckConstraint(
            "char_length(btrim(owner_name)) > 0", name=op.f("ck_accounts_owner_name_not_blank")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_accounts")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_accounts_token_hash")),
    )


def downgrade() -> None:
    op.drop_table("accounts")
