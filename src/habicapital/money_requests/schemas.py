import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from habicapital.ledger.schemas import Counterparty, Description, TransferAmount
from habicapital.money_requests.models import MoneyRequestStatus

# Mismos topes que el historial de movimientos.
MAX_MONEY_REQUESTS_PAGE = 100
MAX_MONEY_REQUESTS_OFFSET = 1_000_000

# sent: las que TÚ pediste. received: las que te pidieron a ti.
MoneyRequestRole = Literal["sent", "received"]
MoneyRequestOrder = Literal["desc", "asc"]


class MoneyRequestCreate(BaseModel):
    # extra="forbid": el cliente no puede indicar el solicitante (es siempre la cuenta del token).
    model_config = ConfigDict(extra="forbid")

    payer_account_id: uuid.UUID
    # Mismo tope que una transferencia: aceptar la solicitud ES una transferencia, así que no
    # se pueden crear solicitudes imposibles de aceptar.
    amount: TransferAmount
    description: Description | None = None


class MoneyRequestRead(BaseModel):
    """Solo id y nombre de cada parte: nunca saldos ni otros datos de las cuentas."""

    id: uuid.UUID
    requester: Counterparty
    payer: Counterparty
    amount: int
    description: str | None
    status: MoneyRequestStatus
    transaction_id: uuid.UUID | None
    created_at: datetime
    resolved_at: datetime | None


class MoneyRequestPage(BaseModel):
    items: list[MoneyRequestRead]
    total: int
    limit: int
    offset: int
    order: MoneyRequestOrder
    role: MoneyRequestRole
    status: MoneyRequestStatus | None
