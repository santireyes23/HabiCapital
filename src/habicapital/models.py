"""Importa todos los modelos ORM para que queden registrados en `Base.metadata`.

Lo usan Alembic (autogenerate) y las pruebas que recorren todas las tablas.
"""

from habicapital.accounts.models import Account
from habicapital.idempotency.models import IdempotencyRecord
from habicapital.ledger.models import LedgerEntry, LedgerTransaction
from habicapital.money_requests.models import MoneyRequest

__all__ = ["Account", "IdempotencyRecord", "LedgerEntry", "LedgerTransaction", "MoneyRequest"]
