"""ledger, funding account and idempotency

Revision ID: e7379a43f6d1
Revises: 13d7369338b8
Create Date: 2026-11-11 19:37:15.219022

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e7379a43f6d1"
down_revision: str | Sequence[str] | None = "13d7369338b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Copia literal de habicapital.accounts.models: una migración no debe depender del código
# de la app, que puede cambiar después.
FUNDING_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001"
FUNDING_ACCOUNT_NAME = "HabiCapital - Fondeo de depósitos"


def upgrade() -> None:
    # --- accounts: tipo de cuenta y saldo ---------------------------------------------------
    # server_default solo para rellenar las filas existentes; luego se quita (la app los fija).
    op.add_column(
        "accounts",
        sa.Column("kind", sa.String(length=10), nullable=False, server_default="USER"),
    )
    op.add_column(
        "accounts",
        sa.Column("balance", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.alter_column("accounts", "kind", server_default=None)
    op.alter_column("accounts", "balance", server_default=None)
    op.alter_column("accounts", "token_hash", existing_type=sa.String(length=64), nullable=True)
    op.create_check_constraint(
        op.f("ck_accounts_kind_is_valid"), "accounts", "kind IN ('USER', 'SYSTEM')"
    )
    op.create_check_constraint(
        op.f("ck_accounts_token_only_for_users"),
        "accounts",
        "(kind = 'USER') = (token_hash IS NOT NULL)",
    )
    op.create_check_constraint(
        op.f("ck_accounts_user_balance_not_negative"),
        "accounts",
        "kind = 'SYSTEM' OR balance >= 0",
    )

    # --- libro contable ---------------------------------------------------------------------
    op.create_table(
        "ledger_transactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("description", sa.String(length=140), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('DEPOSIT')", name=op.f("ck_ledger_transactions_kind_is_valid")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ledger_transactions")),
    )
    op.create_table(
        "ledger_entries",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("transaction_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("balance_after", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("amount <> 0", name=op.f("ck_ledger_entries_amount_not_zero")),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"], name=op.f("fk_ledger_entries_account_id_accounts")
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["ledger_transactions.id"],
            name=op.f("fk_ledger_entries_transaction_id_ledger_transactions"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ledger_entries")),
    )
    op.create_index(
        "ix_ledger_entries_account_id_id", "ledger_entries", ["account_id", "id"], unique=False
    )
    op.create_index(
        op.f("ix_ledger_entries_transaction_id"), "ledger_entries", ["transaction_id"], unique=False
    )

    # --- idempotencia -----------------------------------------------------------------------
    op.create_table(
        "idempotency_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("response_body", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status_code BETWEEN 100 AND 599",
            name=op.f("ck_idempotency_records_status_code_is_http"),
        ),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"], name=op.f("fk_idempotency_records_account_id_accounts")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_idempotency_records")),
        sa.UniqueConstraint("account_id", "key", name="uq_idempotency_records_account_id_key"),
    )

    # --- cuenta de sistema FUNDING ------------------------------------------------------------
    op.execute(
        sa.text(
            "INSERT INTO accounts (id, kind, owner_name, token_hash, balance) "
            "VALUES (CAST(:id AS uuid), 'SYSTEM', :name, NULL, 0)"
        ).bindparams(id=FUNDING_ACCOUNT_ID, name=FUNDING_ACCOUNT_NAME)
    )


def downgrade() -> None:
    op.drop_table("idempotency_records")
    op.drop_index(op.f("ix_ledger_entries_transaction_id"), table_name="ledger_entries")
    op.drop_index("ix_ledger_entries_account_id_id", table_name="ledger_entries")
    op.drop_table("ledger_entries")
    op.drop_table("ledger_transactions")
    op.execute("DELETE FROM accounts WHERE kind = 'SYSTEM'")
    op.drop_constraint(op.f("ck_accounts_user_balance_not_negative"), "accounts", type_="check")
    op.drop_constraint(op.f("ck_accounts_token_only_for_users"), "accounts", type_="check")
    op.drop_constraint(op.f("ck_accounts_kind_is_valid"), "accounts", type_="check")
    op.alter_column("accounts", "token_hash", existing_type=sa.String(length=64), nullable=False)
    op.drop_column("accounts", "balance")
    op.drop_column("accounts", "kind")
