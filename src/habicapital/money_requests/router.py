"""Endpoints de solicitudes de dinero.

Van en /money-requests y no en /accounts/me/...: el id de la URL identifica una SOLICITUD,
nunca una cuenta. La cuenta propia sale siempre del token, y el servicio filtra cada consulta
por ella (una solicitud ajena responde 404).
"""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query, status
from fastapi.responses import JSONResponse

from habicapital.accounts.dependencies import CurrentAccount
from habicapital.db import SessionDep
from habicapital.idempotency.service import request_fingerprint, run_idempotent
from habicapital.ledger.router import IdempotencyKey
from habicapital.money_requests import service
from habicapital.money_requests.models import MoneyRequestStatus
from habicapital.money_requests.schemas import (
    MAX_MONEY_REQUESTS_OFFSET,
    MAX_MONEY_REQUESTS_PAGE,
    MoneyRequestCreate,
    MoneyRequestOrder,
    MoneyRequestPage,
    MoneyRequestRead,
    MoneyRequestRole,
)

router = APIRouter(prefix="/money-requests", tags=["money-requests"])

UNAUTHORIZED: dict[int | str, dict[str, Any]] = {401: {"description": "Token ausente o inválido"}}

CREATE_RESPONSES: dict[int | str, dict[str, Any]] = UNAUTHORIZED | {
    404: {"description": "La cuenta destinataria no existe o no admite solicitudes"},
    422: {
        "description": "Datos inválidos, solicitud a tu propia cuenta o Idempotency-Key "
        "reutilizada con otra solicitud"
    },
}


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=MoneyRequestRead,
    responses=CREATE_RESPONSES,
)
def create_money_request(
    payload: MoneyRequestCreate,
    account: CurrentAccount,
    session: SessionDep,
    idempotency_key: IdempotencyKey,
) -> JSONResponse:
    """Pide pesos COP a otro usuario. No mueve dinero: queda PENDING hasta que el otro responda."""

    def operation() -> MoneyRequestRead:
        return service.create_money_request(
            session, account, payload.payer_account_id, payload.amount, payload.description
        )

    result = run_idempotent(
        session,
        account_id=account.id,
        key=idempotency_key,
        request_hash=request_fingerprint("money_request_create", payload),
        status_code=status.HTTP_201_CREATED,
        operation=operation,
    )
    headers = {"Idempotent-Replayed": "true"} if result.replayed else None
    return JSONResponse(status_code=result.status_code, content=result.body, headers=headers)


@router.get("", responses=UNAUTHORIZED)
def list_my_money_requests(
    account: CurrentAccount,
    session: SessionDep,
    role: Annotated[
        MoneyRequestRole,
        Query(description="sent: las que tú pediste; received: las que te pidieron a ti"),
    ],
    status_filter: Annotated[
        MoneyRequestStatus | None, Query(alias="status", description="Filtra por estado")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_MONEY_REQUESTS_PAGE)] = 20,
    offset: Annotated[int, Query(ge=0, le=MAX_MONEY_REQUESTS_OFFSET)] = 0,
    order: Annotated[
        MoneyRequestOrder, Query(description="desc: más reciente primero; asc: más antigua primero")
    ] = "desc",
) -> MoneyRequestPage:
    """Tus solicitudes, enviadas o recibidas. Paginado con limit/offset (misma limitación que el
    historial: si llegan solicitudes nuevas mientras recorres páginas, estas se desplazan)."""
    return service.list_money_requests(
        session, account.id, role, status_filter, limit, offset, order
    )


@router.get(
    "/{request_id}",
    responses=UNAUTHORIZED | {404: {"description": "No existe o no participas en ella"}},
)
def get_my_money_request(
    request_id: uuid.UUID, account: CurrentAccount, session: SessionDep
) -> MoneyRequestRead:
    """Una solicitud en la que participas, como solicitante o como destinatario."""
    return service.get_money_request(session, account.id, request_id)


RESOLVE_RESPONSES: dict[int | str, dict[str, Any]] = UNAUTHORIZED | {
    404: {"description": "No existe o no te corresponde esta acción"},
    409: {"description": "La solicitud ya fue aceptada, rechazada o cancelada"},
}


@router.post("/{request_id}/reject", responses=RESOLVE_RESPONSES)
def reject_money_request(
    request_id: uuid.UUID, account: CurrentAccount, session: SessionDep
) -> MoneyRequestRead:
    """Rechaza una solicitud que te hicieron. Solo el destinatario puede. No mueve dinero."""
    return service.reject_money_request(session, account.id, request_id)


@router.post("/{request_id}/cancel", responses=RESOLVE_RESPONSES)
def cancel_money_request(
    request_id: uuid.UUID, account: CurrentAccount, session: SessionDep
) -> MoneyRequestRead:
    """Cancela una solicitud que tú hiciste. Solo el solicitante puede. No mueve dinero."""
    return service.cancel_money_request(session, account.id, request_id)
