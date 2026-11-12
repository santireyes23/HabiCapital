from typing import Any

from fastapi import APIRouter, Response, status

from habicapital.accounts import service
from habicapital.accounts.dependencies import CurrentAccount
from habicapital.accounts.schemas import AccountCreate, AccountCreated, AccountRead, TokenRotated
from habicapital.db import SessionDep
from habicapital.errors import InvalidTokenError

router = APIRouter(prefix="/accounts", tags=["accounts"])

# Las rutas sobre la cuenta propia usan /me: el id sale del token, nunca del cliente.

UNAUTHORIZED: dict[int | str, dict[str, Any]] = {401: {"description": "Token ausente o inválido"}}


def _forbid_caching(response: Response) -> None:
    """Las respuestas que contienen un token no deben quedar en cachés intermedias."""
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


@router.post("", status_code=status.HTTP_201_CREATED)
def create_account(
    payload: AccountCreate, session: SessionDep, response: Response
) -> AccountCreated:
    account, token = service.create_account(session, payload.owner_name)
    _forbid_caching(response)
    return AccountCreated(
        id=account.id,
        owner_name=account.owner_name,
        balance=account.balance,
        created_at=account.created_at,
        token=token,
    )


@router.get("/me", responses=UNAUTHORIZED)
def read_my_account(account: CurrentAccount) -> AccountRead:
    return AccountRead.model_validate(account)


@router.post("/me/token", responses=UNAUTHORIZED)
def rotate_my_token(
    account: CurrentAccount, session: SessionDep, response: Response
) -> TokenRotated:
    if account.token_hash is None:  # solo las cuentas de sistema no tienen token
        raise InvalidTokenError
    new_token = service.rotate_token(session, account.id, account.token_hash)
    _forbid_caching(response)
    return TokenRotated(token=new_token)
