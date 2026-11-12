"""create money requests

Revision ID: 688a53fdf426
Revises: 16c8fda76905
Create Date: 2026-11-12 08:42:03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "688a53fdf426"
down_revision: str | Sequence[str] | None = "16c8fda76905"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "money_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("requester_account_id", sa.Uuid(), nullable=False),
        sa.Column("payer_account_id", sa.Uuid(), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("description", sa.String(length=140), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("transaction_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED')",
            name=op.f("ck_money_requests_status_is_valid"),
        ),
        sa.CheckConstraint("amount > 0", name=op.f("ck_money_requests_amount_positive")),
        sa.CheckConstraint(
            "requester_account_id <> payer_account_id",
            name=op.f("ck_money_requests_not_self_request"),
        ),
        sa.CheckConstraint(
            "(status = 'ACCEPTED') = (transaction_id IS NOT NULL)",
            name=op.f("ck_money_requests_transaction_only_when_accepted"),
        ),
        sa.CheckConstraint(
            "(status = 'PENDING') = (resolved_at IS NULL)",
            name=op.f("ck_money_requests_resolved_unless_pending"),
        ),
        sa.ForeignKeyConstraint(
            ["requester_account_id"],
            ["accounts.id"],
            name=op.f("fk_money_requests_requester_account_id_accounts"),
        ),
        sa.ForeignKeyConstraint(
            ["payer_account_id"],
            ["accounts.id"],
            name=op.f("fk_money_requests_payer_account_id_accounts"),
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["ledger_transactions.id"],
            name=op.f("fk_money_requests_transaction_id_ledger_transactions"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_money_requests")),
        sa.UniqueConstraint("transaction_id", name=op.f("uq_money_requests_transaction_id")),
    )
    op.create_index(
        "ix_money_requests_requester_account_id_created_at",
        "money_requests",
        ["requester_account_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_money_requests_payer_account_id_created_at",
        "money_requests",
        ["payer_account_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    # Seguro para el dinero: el ledger y los saldos no cambian. Solo se pierden las solicitudes
    # y el vínculo entre una solicitud aceptada y su transferencia (que sigue en el ledger).
    op.drop_index("ix_money_requests_payer_account_id_created_at", table_name="money_requests")
    op.drop_index("ix_money_requests_requester_account_id_created_at", table_name="money_requests")
    op.drop_table("money_requests")
