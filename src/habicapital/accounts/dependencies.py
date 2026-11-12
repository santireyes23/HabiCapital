from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from habicapital.accounts import service
from habicapital.accounts.models import Account
from habicapital.db import SessionDep
from habicapital.errors import InvalidTokenError

# auto_error=False: los errores de autenticación salen siempre por InvalidTokenError,
# con el mismo cuerpo y cabecera, sin importar si falta el header o el token es inválido.
bearer_scheme = HTTPBearer(
    auto_error=False,
    description="Token de la cuenta. Se entrega una sola vez al crearla o al regenerarlo.",
)


def get_current_account(
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> Account:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise InvalidTokenError
    return service.authenticate(session, credentials.credentials)


CurrentAccount = Annotated[Account, Depends(get_current_account)]
