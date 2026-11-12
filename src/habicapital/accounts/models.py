import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, CheckConstraint, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from habicapital.accounts.security import TOKEN_HASH_LENGTH
from habicapital.db import Base

OWNER_NAME_MAX_LENGTH = 100


class AccountKind(StrEnum):
    USER = "USER"
    # Cuentas internas: no tienen token (nadie puede autenticarse como ellas) y su saldo
    # puede ser negativo. FUNDING es el origen de los depósitos simulados.
    SYSTEM = "SYSTEM"


# Fijo y conocido: lo crea la migración y lo referencian los depósitos.
FUNDING_ACCOUNT_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
FUNDING_ACCOUNT_NAME = "HabiCapital - Fondeo de depósitos"


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        CheckConstraint(
            f"char_length(token_hash) = {TOKEN_HASH_LENGTH}", name="token_hash_is_sha256_hex"
        ),
        CheckConstraint("char_length(btrim(owner_name)) > 0", name="owner_name_not_blank"),
        CheckConstraint("kind IN ('USER', 'SYSTEM')", name="kind_is_valid"),
        # Usuarios: siempre con token. Sistema: nunca con token.
        CheckConstraint("(kind = 'USER') = (token_hash IS NOT NULL)", name="token_only_for_users"),
        # Última defensa contra sobregiros: aunque un bug saltara la validación del servicio,
        # PostgreSQL rechaza la transacción completa.
        CheckConstraint("kind = 'SYSTEM' OR balance >= 0", name="user_balance_not_negative"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(10), default=AccountKind.USER)
    owner_name: Mapped[str] = mapped_column(String(OWNER_NAME_MAX_LENGTH))
    # Hash del token vigente. Único: identifica a la cuenta al autenticar.
    token_hash: Mapped[str | None] = mapped_column(String(TOKEN_HASH_LENGTH), unique=True)
    # Saldo en pesos COP enteros. Solo lo modifica habicapital.ledger.service.
    balance: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    token_rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
