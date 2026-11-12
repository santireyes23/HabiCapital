import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from habicapital.db import Base

IDEMPOTENCY_KEY_MAX_LENGTH = 100


class IdempotencyRecord(Base):
    """Resultado guardado de una operación, para repetirlo ante un reintento con la misma clave.

    Se inserta en la MISMA transacción que la operación: o existen los dos, o ninguno.
    Nunca guarda respuestas con tokens (crear cuenta y regenerar token no pasan por aquí).
    """

    __tablename__ = "idempotency_records"
    __table_args__ = (
        # La clave es única por cuenta: dos usuarios pueden usar la misma clave sin chocar.
        UniqueConstraint("account_id", "key", name="uq_idempotency_records_account_id_key"),
        CheckConstraint("status_code BETWEEN 100 AND 599", name="status_code_is_http"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"))
    key: Mapped[str] = mapped_column(String(IDEMPOTENCY_KEY_MAX_LENGTH))
    # SHA-256 de la operación y su cuerpo: detecta la misma clave usada para otra cosa.
    request_hash: Mapped[str] = mapped_column(String(64))
    status_code: Mapped[int] = mapped_column(Integer)
    response_body: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
