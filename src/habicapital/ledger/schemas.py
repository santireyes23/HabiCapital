import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from habicapital.ledger.models import DESCRIPTION_MAX_LENGTH
from habicapital.ledger.service import MAX_DEPOSIT_COP, MAX_TRANSFER_COP

# strict: rechaza 100.5, "100" y true. El dinero solo entra como entero de pesos COP.
DepositAmount = Annotated[
    int,
    Field(strict=True, gt=0, le=MAX_DEPOSIT_COP, description="Pesos COP enteros, sin decimales"),
]
Description = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=DESCRIPTION_MAX_LENGTH)
]


class DepositCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: DepositAmount
    description: Description | None = None


class DepositRead(BaseModel):
    transaction_id: uuid.UUID
    amount: int
    description: str | None
    balance: int = Field(description="Saldo de la cuenta después del depósito")
    created_at: datetime


TransferAmount = Annotated[
    int,
    Field(strict=True, gt=0, le=MAX_TRANSFER_COP, description="Pesos COP enteros, sin decimales"),
]


class TransferCreate(BaseModel):
    # extra="forbid": el cliente no puede indicar la cuenta de origen (es siempre la suya).
    model_config = ConfigDict(extra="forbid")

    to_account_id: uuid.UUID
    amount: TransferAmount
    description: Description | None = None


class TransferRead(BaseModel):
    transaction_id: uuid.UUID
    to_account_id: uuid.UUID
    amount: int
    description: str | None
    balance: int = Field(description="Saldo de TU cuenta después de la transferencia")
    created_at: datetime


# --- Historial de movimientos (solo lectura) ----------------------------------------------------


class MovementType(StrEnum):
    DEPOSIT = "DEPOSIT"
    TRANSFER_SENT = "TRANSFER_SENT"
    TRANSFER_RECEIVED = "TRANSFER_RECEIVED"


class Direction(StrEnum):
    IN = "IN"
    OUT = "OUT"


MovementOrder = Literal["desc", "asc"]
MAX_MOVEMENTS_PAGE = 100


class Counterparty(BaseModel):
    """Solo lo imprescindible de la otra cuenta: nunca su saldo ni nada privado."""

    account_id: uuid.UUID
    owner_name: str


class MovementRead(BaseModel):
    transaction_id: uuid.UUID
    type: MovementType
    direction: Direction
    amount: int = Field(gt=0, description="Pesos COP, siempre positivo; el sentido lo da direction")
    balance_after: int = Field(description="Saldo de tu cuenta justo después de este movimiento")
    description: str | None
    counterparty: Counterparty | None = Field(
        description="La otra cuenta de una transferencia; null en los depósitos"
    )
    created_at: datetime


class MovementPage(BaseModel):
    items: list[MovementRead]
    total: int = Field(description="Movimientos totales de la cuenta, no solo los de esta página")
    limit: int
    offset: int
    order: MovementOrder
