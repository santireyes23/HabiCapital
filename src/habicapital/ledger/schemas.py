import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from habicapital.ledger.models import DESCRIPTION_MAX_LENGTH
from habicapital.ledger.service import MAX_DEPOSIT_COP

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
