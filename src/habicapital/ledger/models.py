import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from habicapital.db import Base

DESCRIPTION_MAX_LENGTH = 140


class TransactionKind(StrEnum):
    DEPOSIT = "DEPOSIT"


class LedgerTransaction(Base):
    """Un hecho contable. Inmutable: nunca se actualiza ni se borra."""

    __tablename__ = "ledger_transactions"
    __table_args__ = (CheckConstraint("kind IN ('DEPOSIT')", name="kind_is_valid"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(20))
    description: Mapped[str | None] = mapped_column(String(DESCRIPTION_MAX_LENGTH))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LedgerEntry(Base):
    """Un asiento: cuánto cambió el saldo de una cuenta dentro de una transacción.

    Los asientos de cada transacción suman exactamente 0 (doble partida).
    """

    __tablename__ = "ledger_entries"
    __table_args__ = (
        CheckConstraint("amount <> 0", name="amount_not_zero"),
        # Historial de una cuenta en orden.
        Index("ix_ledger_entries_account_id_id", "account_id", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    transaction_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ledger_transactions.id"), index=True
    )
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"))
    # Pesos COP enteros, con signo: positivo entra a la cuenta, negativo sale.
    amount: Mapped[int] = mapped_column(BigInteger)
    balance_after: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
