"""Casos de uso de las solicitudes de dinero.

Crear una solicitud NO mueve dinero: solo inserta una fila PENDING. No toca saldos ni el
ledger, y no bloquea cuentas. El dinero se mueve únicamente al aceptarla (otra etapa), con la
transferencia normal de `habicapital.ledger.service`.

Autorización: la cuenta propia la decide siempre el router a partir del token. Cada consulta
filtra por esa cuenta, así que una solicitud ajena es indistinguible de una inexistente (404).
"""

import uuid
from typing import Any

from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session, aliased

from habicapital.accounts.models import Account, AccountKind
from habicapital.errors import MoneyRequestNotFoundError, PayerNotFoundError, SelfMoneyRequestError
from habicapital.ledger.schemas import Counterparty
from habicapital.money_requests.models import MoneyRequest, MoneyRequestStatus
from habicapital.money_requests.schemas import (
    MoneyRequestOrder,
    MoneyRequestPage,
    MoneyRequestRead,
    MoneyRequestRole,
)


def _to_read(request: MoneyRequest, requester_name: str, payer_name: str) -> MoneyRequestRead:
    return MoneyRequestRead(
        id=request.id,
        requester=Counterparty(account_id=request.requester_account_id, owner_name=requester_name),
        payer=Counterparty(account_id=request.payer_account_id, owner_name=payer_name),
        amount=request.amount,
        description=request.description,
        status=MoneyRequestStatus(request.status),
        transaction_id=request.transaction_id,
        created_at=request.created_at,
        resolved_at=request.resolved_at,
    )


def create_money_request(
    session: Session,
    requester: Account,
    payer_account_id: uuid.UUID,
    amount: int,
    description: str | None,
) -> MoneyRequestRead:
    """Crea una solicitud PENDING. No confirma: lo hace `run_idempotent` junto con su registro.

    No se comprueba el saldo del pagador: pedir plata no depende de que el otro la tenga, y
    hacerlo revelaría su saldo. La existencia y el tipo de una cuenta no cambian (no se borran
    cuentas), así que validar al pagador sin bloquearlo no abre condiciones de carrera.
    """
    if payer_account_id == requester.id:
        raise SelfMoneyRequestError
    payer = session.get(Account, payer_account_id)
    if payer is None or payer.kind != AccountKind.USER:
        raise PayerNotFoundError

    request = MoneyRequest(
        requester_account_id=requester.id,
        payer_account_id=payer.id,
        amount=amount,
        description=description,
        status=MoneyRequestStatus.PENDING,
    )
    session.add(request)
    session.flush()
    return _to_read(request, requester.owner_name, payer.owner_name)


def get_money_request(
    session: Session, account_id: uuid.UUID, request_id: uuid.UUID
) -> MoneyRequestRead:
    """Una solicitud en la que `account_id` participa (como solicitante o pagador)."""
    requester = aliased(Account)
    payer = aliased(Account)
    row = session.execute(
        select(MoneyRequest, requester.owner_name, payer.owner_name)
        .join(requester, requester.id == MoneyRequest.requester_account_id)
        .join(payer, payer.id == MoneyRequest.payer_account_id)
        .where(
            MoneyRequest.id == request_id,
            or_(
                MoneyRequest.requester_account_id == account_id,
                MoneyRequest.payer_account_id == account_id,
            ),
        )
    ).one_or_none()
    if row is None:
        raise MoneyRequestNotFoundError
    request, requester_name, payer_name = row
    return _to_read(request, requester_name, payer_name)


# La columna y el sentido salen solo de estos diccionarios: nunca se interpola texto del cliente.
_ROLE_COLUMN: dict[MoneyRequestRole, str] = {
    "sent": "requester_account_id",
    "received": "payer_account_id",
}
_SQL_DIRECTION: dict[MoneyRequestOrder, str] = {"desc": "DESC", "asc": "ASC"}

# Una sola sentencia, como el historial: página y total salen de la misma instantánea.
# `LEFT JOIN page ON true` devuelve el total aunque la página esté vacía. El id desempata
# solicitudes con el mismo created_at.
_LIST_QUERY = """
WITH filtered AS (
    SELECT * FROM money_requests
    WHERE {role_column} = :account_id
      AND (CAST(:status AS varchar) IS NULL OR status = CAST(:status AS varchar))
),
total AS (SELECT COUNT(*) AS total FROM filtered),
page AS (
    SELECT * FROM filtered
    ORDER BY created_at {direction}, id {direction}
    LIMIT :limit OFFSET :offset
)
SELECT
    total.total,
    page.id,
    page.requester_account_id,
    requester.owner_name AS requester_name,
    page.payer_account_id,
    payer.owner_name AS payer_name,
    page.amount,
    page.description,
    page.status,
    page.transaction_id,
    page.created_at,
    page.resolved_at
FROM total
LEFT JOIN page ON true
LEFT JOIN accounts requester ON requester.id = page.requester_account_id
LEFT JOIN accounts payer ON payer.id = page.payer_account_id
ORDER BY page.created_at {direction}, page.id {direction}
"""


def _row_to_read(row: Any) -> MoneyRequestRead:
    return MoneyRequestRead(
        id=row.id,
        requester=Counterparty(account_id=row.requester_account_id, owner_name=row.requester_name),
        payer=Counterparty(account_id=row.payer_account_id, owner_name=row.payer_name),
        amount=row.amount,
        description=row.description,
        status=MoneyRequestStatus(row.status),
        transaction_id=row.transaction_id,
        created_at=row.created_at,
        resolved_at=row.resolved_at,
    )


def list_money_requests(
    session: Session,
    account_id: uuid.UUID,
    role: MoneyRequestRole,
    status: MoneyRequestStatus | None,
    limit: int,
    offset: int,
    order: MoneyRequestOrder,
) -> MoneyRequestPage:
    """Solicitudes enviadas o recibidas por `account_id`, que el router toma SIEMPRE del token."""
    query = _LIST_QUERY.format(role_column=_ROLE_COLUMN[role], direction=_SQL_DIRECTION[order])
    rows = session.execute(
        text(query),
        {
            "account_id": account_id,
            "status": None if status is None else status.value,
            "limit": limit,
            "offset": offset,
        },
    ).all()
    total = rows[0].total if rows else 0
    items = [_row_to_read(row) for row in rows if row.id is not None]
    return MoneyRequestPage(
        items=items, total=total, limit=limit, offset=offset, order=order, role=role, status=status
    )
