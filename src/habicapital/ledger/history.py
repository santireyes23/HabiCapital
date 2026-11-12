"""Historial de movimientos de una cuenta. Exclusivamente de lectura: no escribe ni bloquea.

Se construye desde el ledger existente, sin tablas propias:
- cada movimiento es un asiento (`ledger_entries`) de la cuenta;
- su tipo sale de la transacción (`kind`) y del signo del asiento;
- la contraparte es el OTRO asiento de la misma transacción. Hoy toda transacción tiene
  exactamente dos asientos (depósito: FUNDING y usuario; transferencia: emisor y receptor).
"""

import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from habicapital.accounts.models import AccountKind
from habicapital.ledger.models import TransactionKind
from habicapital.ledger.schemas import (
    Counterparty,
    Direction,
    MovementOrder,
    MovementPage,
    MovementRead,
    MovementType,
)

# El sentido solo puede ser uno de estos dos literales: nunca se interpola texto del cliente.
_SQL_DIRECTION: dict[MovementOrder, str] = {"desc": "DESC", "asc": "ASC"}

# Una sola sentencia: en PostgreSQL cada sentencia ve una única instantánea, así que la página
# y el total son coherentes aunque haya operaciones en curso. `LEFT JOIN page ON true` devuelve
# una fila con el total incluso cuando la página está vacía (offset más allá del final).
# Se ordena por ledger_entries.id (único y creciente): sin empates y con el índice existente
# ix_ledger_entries_account_id_id.
_QUERY = """
WITH total AS (
    SELECT COUNT(*) AS total FROM ledger_entries WHERE account_id = :account_id
),
page AS (
    SELECT id, transaction_id, amount, balance_after
    FROM ledger_entries
    WHERE account_id = :account_id
    ORDER BY id {direction}
    LIMIT :limit OFFSET :offset
)
SELECT
    total.total,
    page.id AS entry_id,
    page.transaction_id,
    page.amount,
    page.balance_after,
    t.kind,
    t.description,
    t.created_at,
    cp.id AS counterparty_id,
    cp.owner_name AS counterparty_name,
    cp.kind AS counterparty_kind
FROM total
LEFT JOIN page ON true
LEFT JOIN ledger_transactions t ON t.id = page.transaction_id
LEFT JOIN ledger_entries other
    ON other.transaction_id = page.transaction_id AND other.account_id <> :account_id
LEFT JOIN accounts cp ON cp.id = other.account_id
ORDER BY page.id {direction}
"""


def _movement_type(kind: str, amount: int) -> MovementType:
    if kind == TransactionKind.DEPOSIT:
        return MovementType.DEPOSIT
    return MovementType.TRANSFER_SENT if amount < 0 else MovementType.TRANSFER_RECEIVED


def _to_movement(row: Any) -> MovementRead:
    counterparty = None
    # FUNDING (y cualquier cuenta de sistema) nunca se muestra como contraparte.
    if row.counterparty_id is not None and row.counterparty_kind == AccountKind.USER:
        counterparty = Counterparty(
            account_id=row.counterparty_id, owner_name=row.counterparty_name
        )
    return MovementRead(
        transaction_id=row.transaction_id,
        type=_movement_type(row.kind, row.amount),
        direction=Direction.IN if row.amount > 0 else Direction.OUT,
        amount=abs(row.amount),
        balance_after=row.balance_after,
        description=row.description,
        counterparty=counterparty,
        created_at=row.created_at,
    )


def list_movements(
    session: Session, account_id: uuid.UUID, limit: int, offset: int, order: MovementOrder
) -> MovementPage:
    """Movimientos de `account_id`, que el router toma SIEMPRE de la cuenta autenticada."""
    rows = session.execute(
        text(_QUERY.format(direction=_SQL_DIRECTION[order])),
        {"account_id": account_id, "limit": limit, "offset": offset},
    ).all()
    total = rows[0].total if rows else 0
    items = [_to_movement(row) for row in rows if row.entry_id is not None]
    return MovementPage(items=items, total=total, limit=limit, offset=offset, order=order)
