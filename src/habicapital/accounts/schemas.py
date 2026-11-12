import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from habicapital.accounts.models import OWNER_NAME_MAX_LENGTH

OwnerName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=OWNER_NAME_MAX_LENGTH),
]

TOKEN_DESCRIPTION = (
    "Token de acceso. Se muestra solo en esta respuesta: guárdalo, no se puede recuperar."
)


class AccountCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    owner_name: OwnerName


class AccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_name: str
    balance: int = Field(description="Saldo en pesos COP enteros")
    created_at: datetime


class AccountCreated(AccountRead):
    token: str = Field(description=TOKEN_DESCRIPTION)


class TokenRotated(BaseModel):
    token: str = Field(description=TOKEN_DESCRIPTION)
