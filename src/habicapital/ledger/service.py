"""Libro contable de doble partida. Es el ÚNICO código que modifica `Account.balance`.

Reglas:
- Montos en pesos COP enteros (`int`), nunca float.
- Cada transacción tiene al menos dos asientos, cada uno de una cuenta distinta, y su suma es 0.
  Por eso la suma de los saldos de todas las cuentas (incluida FUNDING) es siempre 0.
- Las cuentas involucradas se bloquean con SELECT ... FOR UPDATE en orden de id, lo que
  serializa las operaciones concurrentes sobre la misma cuenta y evita interbloqueos.
- No confirma: el caso de uso que llama hace `session.commit()`, así que la operación entera
  (asientos, saldos y registro de idempotencia) se guarda o se descarta junta.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from habicapital.accounts.models import FUNDING_ACCOUNT_ID, Account, AccountKind
from habicapital.errors import (
    AccountNotFoundError,
    DestinationNotFoundError,
    InsufficientFundsError,
    SelfTransferError,
)
from habicapital.ledger.models import LedgerEntry, LedgerTransaction, TransactionKind

MAX_DEPOSIT_COP = 10_000_000
MAX_TRANSFER_COP = 10_000_000


@dataclass(frozen=True)
class Leg:
    account_id: uuid.UUID
    amount: int


def _validate_legs(legs: list[Leg]) -> None:
    if len(legs) < 2:
        raise ValueError("una transacción necesita al menos dos asientos")
    for leg in legs:
        # bool es subclase de int en Python: se excluye explícitamente.
        if type(leg.amount) is not int or leg.amount == 0:
            raise ValueError("cada asiento debe ser un entero distinto de 0")
    if len({leg.account_id for leg in legs}) != len(legs):
        raise ValueError("una cuenta no puede aparecer dos veces en la misma transacción")
    if sum(leg.amount for leg in legs) != 0:
        raise ValueError("los asientos de una transacción deben sumar 0")


def post_transaction(
    session: Session, kind: TransactionKind, legs: list[Leg], description: str | None = None
) -> LedgerTransaction:
    _validate_legs(legs)
    account_ids = sorted(leg.account_id for leg in legs)
    locked = session.scalars(
        select(Account)
        .where(Account.id.in_(account_ids))
        .order_by(Account.id)
        .with_for_update()
        # Sin esto, una cuenta ya cargada en la sesión (p. ej. la autenticada) conservaría el
        # saldo leído ANTES del bloqueo, y dos operaciones concurrentes perderían una de ellas.
        .execution_options(populate_existing=True)
    ).all()
    accounts = {account.id: account for account in locked}
    if len(accounts) != len(account_ids):
        raise AccountNotFoundError

    transaction = LedgerTransaction(kind=kind, description=description)
    session.add(transaction)
    session.flush()

    for leg in legs:
        account = accounts[leg.account_id]
        new_balance = account.balance + leg.amount
        if account.kind == AccountKind.USER and new_balance < 0:
            raise InsufficientFundsError
        account.balance = new_balance
        session.add(
            LedgerEntry(
                transaction_id=transaction.id,
                account_id=account.id,
                amount=leg.amount,
                balance_after=new_balance,
            )
        )
    session.flush()
    return transaction


def deposit(
    session: Session, account_id: uuid.UUID, amount: int, description: str | None
) -> LedgerTransaction:
    """Depósito simulado: la plata sale de la cuenta de sistema FUNDING."""
    return post_transaction(
        session,
        TransactionKind.DEPOSIT,
        [Leg(FUNDING_ACCOUNT_ID, -amount), Leg(account_id, amount)],
        description,
    )


def transfer(
    session: Session,
    from_account_id: uuid.UUID,
    to_account_id: uuid.UUID,
    amount: int,
    description: str | None,
) -> LedgerTransaction:
    """Transferencia entre dos cuentas de usuario.

    El origen es siempre la cuenta autenticada (lo decide el router, nunca el cliente).
    La existencia y el tipo de una cuenta no cambian (no se borran cuentas), así que validar
    el destino antes del bloqueo no abre una condición de carrera. El saldo, en cambio, solo
    se comprueba dentro de post_transaction, con las dos filas ya bloqueadas.
    """
    if to_account_id == from_account_id:
        raise SelfTransferError
    destination = session.get(Account, to_account_id)
    if destination is None or destination.kind != AccountKind.USER:
        raise DestinationNotFoundError
    return post_transaction(
        session,
        TransactionKind.TRANSFER,
        [Leg(from_account_id, -amount), Leg(to_account_id, amount)],
        description,
    )
