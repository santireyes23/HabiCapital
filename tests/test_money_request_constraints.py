"""Restricciones de `money_requests` en la propia BD: la última defensa si el servicio fallara.

Se insertan filas con SQL directo, saltándose la API a propósito (requiere PostgreSQL).
"""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import IntegrityError

from tests.conftest import create_account

pytestmark = pytest.mark.db


def _insert_request(engine: Engine, **overrides: Any) -> uuid.UUID:
    values: dict[str, Any] = {
        "id": uuid.uuid4(),
        "status": "PENDING",
        "amount": 1_000,
        "transaction_id": None,
        "resolved_at": None,
    } | overrides
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO money_requests (id, requester_account_id, payer_account_id, amount, "
                "status, transaction_id, resolved_at) VALUES (:id, :requester, :payer, :amount, "
                ":status, :transaction_id, CAST(:resolved_at AS timestamptz))"
            ),
            values,
        )
    request_id: uuid.UUID = values["id"]
    return request_id


def _insert_transaction(engine: Engine) -> uuid.UUID:
    transaction_id = uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO ledger_transactions (id, kind) VALUES (:id, 'TRANSFER')"),
            {"id": transaction_id},
        )
    return transaction_id


@pytest.fixture
def parties(client: TestClient, db: Engine) -> dict[str, str]:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    return {"requester": ana.id, "payer": beto.id}


def test_valid_pending_request_is_accepted_by_the_database(
    db: Engine, parties: dict[str, str]
) -> None:
    request_id = _insert_request(db, **parties)

    with db.connect() as connection:
        row = connection.execute(
            text("SELECT status, created_at FROM money_requests WHERE id = :id"), {"id": request_id}
        ).one()
    assert row.status == "PENDING"
    assert row.created_at is not None


def test_valid_accepted_request_with_its_transaction_is_accepted(
    db: Engine, parties: dict[str, str]
) -> None:
    transaction_id = _insert_transaction(db)
    _insert_request(
        db, **parties, status="ACCEPTED", transaction_id=transaction_id, resolved_at="now"
    )


@pytest.mark.parametrize("status", ["REJECTED", "CANCELLED"])
def test_valid_closed_request_without_transaction_is_accepted(
    db: Engine, parties: dict[str, str], status: str
) -> None:
    _insert_request(db, **parties, status=status, resolved_at="now")


@pytest.mark.parametrize("status", ["EXPIRED", "pending", "", "PAID"])
def test_unknown_status_is_rejected(db: Engine, parties: dict[str, str], status: str) -> None:
    # Con resolved_at, para que solo pueda fallar la restricción de estado.
    with pytest.raises(IntegrityError, match="status_is_valid"):
        _insert_request(db, **parties, status=status, resolved_at="now")


@pytest.mark.parametrize("amount", [0, -1, -1_000])
def test_non_positive_amount_is_rejected(db: Engine, parties: dict[str, str], amount: int) -> None:
    with pytest.raises(IntegrityError, match="amount_positive"):
        _insert_request(db, **parties, amount=amount)


def test_request_to_oneself_is_rejected(db: Engine, parties: dict[str, str]) -> None:
    with pytest.raises(IntegrityError, match="not_self_request"):
        _insert_request(db, requester=parties["requester"], payer=parties["requester"])


def test_accepted_request_without_transaction_is_rejected(
    db: Engine, parties: dict[str, str]
) -> None:
    with pytest.raises(IntegrityError, match="transaction_only_when_accepted"):
        _insert_request(db, **parties, status="ACCEPTED", resolved_at="now")


@pytest.mark.parametrize("status", ["PENDING", "REJECTED", "CANCELLED"])
def test_transaction_on_a_non_accepted_request_is_rejected(
    db: Engine, parties: dict[str, str], status: str
) -> None:
    transaction_id = _insert_transaction(db)
    resolved_at = None if status == "PENDING" else "now"
    with pytest.raises(IntegrityError, match="transaction_only_when_accepted"):
        _insert_request(
            db, **parties, status=status, transaction_id=transaction_id, resolved_at=resolved_at
        )


def test_pending_request_with_resolution_date_is_rejected(
    db: Engine, parties: dict[str, str]
) -> None:
    with pytest.raises(IntegrityError, match="resolved_unless_pending"):
        _insert_request(db, **parties, resolved_at="now")


@pytest.mark.parametrize("status", ["REJECTED", "CANCELLED"])
def test_closed_request_without_resolution_date_is_rejected(
    db: Engine, parties: dict[str, str], status: str
) -> None:
    with pytest.raises(IntegrityError, match="resolved_unless_pending"):
        _insert_request(db, **parties, status=status)


def test_one_transaction_cannot_settle_two_requests(db: Engine, parties: dict[str, str]) -> None:
    transaction_id = _insert_transaction(db)
    accepted = {"status": "ACCEPTED", "transaction_id": transaction_id, "resolved_at": "now"}
    _insert_request(db, **parties, **accepted)

    with pytest.raises(IntegrityError, match="uq_money_requests_transaction_id"):
        _insert_request(db, **parties, **accepted)


def test_unknown_transaction_is_rejected(db: Engine, parties: dict[str, str]) -> None:
    with pytest.raises(IntegrityError, match="fk_money_requests_transaction_id"):
        _insert_request(
            db, **parties, status="ACCEPTED", transaction_id=uuid.uuid4(), resolved_at="now"
        )


@pytest.mark.parametrize("role", ["requester", "payer"])
def test_unknown_account_is_rejected(db: Engine, parties: dict[str, str], role: str) -> None:
    with pytest.raises(IntegrityError, match=f"fk_money_requests_{role}_account_id"):
        _insert_request(db, **(parties | {role: str(uuid.uuid4())}))
