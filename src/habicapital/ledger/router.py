from typing import Annotated, Any

from fastapi import APIRouter, Header, status
from fastapi.responses import JSONResponse

from habicapital.accounts.dependencies import CurrentAccount
from habicapital.db import SessionDep
from habicapital.idempotency.models import IDEMPOTENCY_KEY_MAX_LENGTH
from habicapital.idempotency.service import request_fingerprint, run_idempotent
from habicapital.ledger import service
from habicapital.ledger.schemas import DepositCreate, DepositRead, TransferCreate, TransferRead

router = APIRouter(prefix="/accounts/me", tags=["ledger"])

IdempotencyKey = Annotated[
    str,
    Header(
        alias="Idempotency-Key",
        min_length=1,
        max_length=IDEMPOTENCY_KEY_MAX_LENGTH,
        pattern=r"^[A-Za-z0-9._:-]+$",
        description="Clave única por operación (p. ej. un UUID). Reintentar con la misma "
        "clave devuelve el resultado original sin volver a mover dinero.",
    ),
]

RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"description": "Token ausente o inválido"},
    422: {"description": "Datos inválidos o Idempotency-Key reutilizada con otra solicitud"},
}


@router.post(
    "/deposits",
    status_code=status.HTTP_201_CREATED,
    response_model=DepositRead,
    responses=RESPONSES,
)
def create_deposit(
    payload: DepositCreate,
    account: CurrentAccount,
    session: SessionDep,
    idempotency_key: IdempotencyKey,
) -> JSONResponse:
    """Depósito simulado en pesos COP (no hay pasarela de pago real)."""
    account_id = account.id

    def operation() -> DepositRead:
        transaction = service.deposit(session, account_id, payload.amount, payload.description)
        return DepositRead(
            transaction_id=transaction.id,
            amount=payload.amount,
            description=transaction.description,
            balance=account.balance,
            created_at=transaction.created_at,
        )

    result = run_idempotent(
        session,
        account_id=account_id,
        key=idempotency_key,
        request_hash=request_fingerprint("deposit", payload),
        status_code=status.HTTP_201_CREATED,
        operation=operation,
    )
    headers = {"Idempotent-Replayed": "true"} if result.replayed else None
    return JSONResponse(status_code=result.status_code, content=result.body, headers=headers)


TRANSFER_RESPONSES: dict[int | str, dict[str, Any]] = RESPONSES | {
    404: {"description": "La cuenta de destino no existe o no admite transferencias"},
    409: {"description": "Saldo insuficiente (no consume la Idempotency-Key)"},
}


@router.post(
    "/transfers",
    status_code=status.HTTP_201_CREATED,
    response_model=TransferRead,
    responses=TRANSFER_RESPONSES,
)
def create_transfer(
    payload: TransferCreate,
    account: CurrentAccount,
    session: SessionDep,
    idempotency_key: IdempotencyKey,
) -> JSONResponse:
    """Transfiere pesos COP desde tu cuenta a la cuenta de otro usuario."""
    account_id = account.id

    def operation() -> TransferRead:
        transaction = service.transfer(
            session, account_id, payload.to_account_id, payload.amount, payload.description
        )
        return TransferRead(
            transaction_id=transaction.id,
            to_account_id=payload.to_account_id,
            amount=payload.amount,
            description=transaction.description,
            balance=account.balance,
            created_at=transaction.created_at,
        )

    result = run_idempotent(
        session,
        account_id=account_id,
        key=idempotency_key,
        request_hash=request_fingerprint("transfer", payload),
        status_code=status.HTTP_201_CREATED,
        operation=operation,
    )
    headers = {"Idempotent-Replayed": "true"} if result.replayed else None
    return JSONResponse(status_code=result.status_code, content=result.body, headers=headers)
