"""allow transfer transactions

Revision ID: 16c8fda76905
Revises: e7379a43f6d1
Create Date: 2026-11-11 20:08:36.090583

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "16c8fda76905"
down_revision: str | Sequence[str] | None = "e7379a43f6d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINT = "ck_ledger_transactions_kind_is_valid"


def upgrade() -> None:
    op.drop_constraint(op.f(CONSTRAINT), "ledger_transactions", type_="check")
    op.create_check_constraint(
        op.f(CONSTRAINT), "ledger_transactions", "kind IN ('DEPOSIT', 'TRANSFER')"
    )


def downgrade() -> None:
    # Borrar transferencias descuadraría los saldos (perder o crear plata), así que el
    # downgrade se niega a continuar si ya existe alguna.
    transfers = (
        op.get_bind()
        .execute(sa.text("SELECT COUNT(*) FROM ledger_transactions WHERE kind = 'TRANSFER'"))
        .scalar_one()
    )
    if transfers:
        raise RuntimeError(
            f"No se puede revertir: hay {transfers} transferencias registradas en el ledger."
        )
    op.drop_constraint(op.f(CONSTRAINT), "ledger_transactions", type_="check")
    op.create_check_constraint(op.f(CONSTRAINT), "ledger_transactions", "kind IN ('DEPOSIT')")
