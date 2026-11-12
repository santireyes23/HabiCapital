import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from habicapital.db import Base
from habicapital.ledger.models import DESCRIPTION_MAX_LENGTH


class MoneyRequestStatus(StrEnum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class MoneyRequest(Base):
    """Una cuenta (solicitante) le pide plata a otra (pagador).

    Crearla no mueve dinero. Solo aceptarla lo hace, mediante una transferencia normal del
    ledger (pagador -> solicitante) cuyo id queda en `transaction_id`. Los estados distintos de
    PENDING son finales. Las restricciones de abajo son la última defensa en la BD: aunque un
    bug saltara las validaciones del servicio, PostgreSQL rechazaría la transacción completa.
    """

    __tablename__ = "money_requests"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED')", name="status_is_valid"
        ),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("requester_account_id <> payer_account_id", name="not_self_request"),
        # Una solicitud aceptada siempre tiene su transferencia, y ninguna otra la tiene.
        CheckConstraint(
            "(status = 'ACCEPTED') = (transaction_id IS NOT NULL)",
            name="transaction_only_when_accepted",
        ),
        CheckConstraint(
            "(status = 'PENDING') = (resolved_at IS NULL)", name="resolved_unless_pending"
        ),
        # Listados de "enviadas" y "recibidas" de una cuenta, en orden.
        Index(
            "ix_money_requests_requester_account_id_created_at",
            "requester_account_id",
            "created_at",
        ),
        Index("ix_money_requests_payer_account_id_created_at", "payer_account_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Quien pide la plata y la recibe al aceptarse.
    requester_account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"))
    # A quien se le pide: el único que puede aceptarla o rechazarla.
    payer_account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"))
    # Pesos COP enteros.
    amount: Mapped[int] = mapped_column(BigInteger)
    description: Mapped[str | None] = mapped_column(String(DESCRIPTION_MAX_LENGTH))
    status: Mapped[str] = mapped_column(String(20), default=MoneyRequestStatus.PENDING)
    # Único: una transferencia no puede saldar dos solicitudes.
    transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ledger_transactions.id"), unique=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
