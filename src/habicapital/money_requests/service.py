"""Casos de uso de las solicitudes de dinero.

Crear una solicitud NO mueve dinero: solo inserta una fila PENDING. No toca saldos ni el
ledger, y no bloquea cuentas. El dinero se mueve únicamente al aceptarla, con la
transferencia normal de `habicapital.ledger.service`.

Autorización: la cuenta propia la decide siempre el router a partir del token. Cada consulta
filtra por esa cuenta, así que una solicitud ajena es indistinguible de una inexistente (404).

Resolver (rechazar, cancelar): se bloquea la fila de la solicitud con SELECT ... FOR UPDATE y
el estado se comprueba DESPUÉS de obtener el bloqueo. Si dos operaciones llegan a la vez, la
segunda espera a que la primera confirme, relee la fila y ve que ya no está PENDING (409).
Orden de bloqueo global: primero la solicitud y después, si hace falta, las cuentas. Ningún
camino bloquea cuentas y luego solicitudes, así que no hay ciclos de espera.
"""

import uuid
from typing import Any

from sqlalchemy import ColumnElement, func, or_, select, text
from sqlalchemy.orm import Session, aliased

from habicapital.accounts.models import Account, AccountKind
from habicapital.errors import (
    MoneyRequestNotFoundError,
    MoneyRequestNotPendingError,
    PayerNotFoundError,
    SelfMoneyRequestError,
)
from habicapital.ledger import service as ledger_service
from habicapital.ledger.schemas import Counterparty
from habicapital.money_requests.models import MoneyRequest, MoneyRequestStatus
from habicapital.money_requests.schemas import (
    MoneyRequestAccepted,
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


def _lock_request(
    session: Session, request_id: uuid.UUID, allowed: ColumnElement[bool]
) -> MoneyRequest:
    """Bloquea la solicitud si la cuenta autenticada puede actuar sobre ella (`allowed`).

    Sin permiso responde lo mismo que si no existiera (404). `populate_existing` garantiza que
    el estado leído es el de la fila YA bloqueada, no uno cargado antes en la sesión.
    """
    request = session.scalars(
        select(MoneyRequest)
        .where(MoneyRequest.id == request_id, allowed)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one_or_none()
    if request is None:
        raise MoneyRequestNotFoundError
    return request


def _close(
    session: Session,
    account_id: uuid.UUID,
    request_id: uuid.UUID,
    allowed: ColumnElement[bool],
    new_status: MoneyRequestStatus,
) -> MoneyRequestRead:
    """Pasa una solicitud PENDING a un estado final sin mover dinero (no toca cuentas ni ledger)."""
    request = _lock_request(session, request_id, allowed)
    if request.status != MoneyRequestStatus.PENDING:
        raise MoneyRequestNotPendingError
    request.status = new_status
    request.resolved_at = func.now()
    session.commit()
    # El estado ya es final: releerla después de confirmar no puede dar otro resultado.
    return get_money_request(session, account_id, request_id)


def reject_money_request(
    session: Session, account_id: uuid.UUID, request_id: uuid.UUID
) -> MoneyRequestRead:
    """Solo el pagador rechaza."""
    return _close(
        session,
        account_id,
        request_id,
        MoneyRequest.payer_account_id == account_id,
        MoneyRequestStatus.REJECTED,
    )


def cancel_money_request(
    session: Session, account_id: uuid.UUID, request_id: uuid.UUID
) -> MoneyRequestRead:
    """Solo el solicitante cancela."""
    return _close(
        session,
        account_id,
        request_id,
        MoneyRequest.requester_account_id == account_id,
        MoneyRequestStatus.CANCELLED,
    )


def lock_for_acceptance(
    session: Session, payer_account_id: uuid.UUID, request_id: uuid.UUID
) -> MoneyRequest:
    """Primer paso de aceptar: bloquea la solicitud si `payer_account_id` es su pagador (404 si no).

    El router lo llama ANTES de consultar la Idempotency-Key. Así, si dos aceptaciones con la
    misma clave llegan a la vez, la segunda espera aquí a que la primera confirme y, al buscar
    después la clave, ya ve su registro y repite su respuesta (en vez de responder 409).
    """
    return _lock_request(session, request_id, MoneyRequest.payer_account_id == payer_account_id)


def accept_locked_money_request(
    session: Session, payer: Account, request: MoneyRequest
) -> MoneyRequestAccepted:
    """Segundo paso: paga la solicitud ya bloqueada por `lock_for_acceptance`.

    No confirma. La transferencia (que tampoco confirma), el cambio de estado y el registro de
    idempotencia los confirma `run_idempotent` en UNA sola transacción; cualquier excepción
    antes de eso la descarta entera al cerrar la sesión.

    Orden de bloqueo: la solicitud ya está bloqueada; `transfer` bloquea después las dos cuentas
    en orden ascendente de id. Si no hay saldo, `transfer` lanza InsufficientFundsError (409) y
    el rollback deja la solicitud PENDING.
    """
    if request.status != MoneyRequestStatus.PENDING:
        raise MoneyRequestNotPendingError
    # La misma transferencia que POST /accounts/me/transfers: valida al destinatario, bloquea,
    # comprueba saldo y escribe los asientos de doble partida. No hay otra lógica de dinero.
    transaction = ledger_service.transfer(
        session, payer.id, request.requester_account_id, request.amount, request.description
    )
    request.status = MoneyRequestStatus.ACCEPTED
    request.transaction_id = transaction.id
    request.resolved_at = func.now()
    session.flush()

    # Ya cargado (y bloqueado) por transfer: no es una consulta nueva.
    requester = session.get(Account, request.requester_account_id)
    if requester is None:  # pragma: no cover - la FK y el bloqueo garantizan que existe
        raise MoneyRequestNotFoundError
    read = _to_read(request, requester.owner_name, payer.owner_name)
    # `payer` es la cuenta autenticada: transfer la releyó al bloquearla (populate_existing),
    # así que su saldo es el posterior al pago.
    return MoneyRequestAccepted(**read.model_dump(), balance=payer.balance)
