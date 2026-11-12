"""Los estados finales de una solicitud son inmutables en la propia BD (trigger).

Las solicitudes se resuelven por la API real; después se intenta manipularlas con SQL directo,
saltándose el servicio, como lo haría un bug (requiere PostgreSQL).
"""

import uuid
from collections.abc import Callable
from typing import Any

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import IntegrityError

from tests.conftest import (
    CreatedAccount,
    alembic_config,
    assert_ledger_is_consistent,
    bearer,
    create_account,
    deposit_request,
    money_request_create,
)

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("db")]

GUARD = "money_requests_guard_final_states"
BEFORE_GUARD = "688a53fdf426"


def _sql(engine: Engine, sql: str, **params: object) -> None:
    with engine.begin() as connection:
        connection.execute(text(sql), params)


def _row(engine: Engine, request_id: str) -> Any:
    with engine.connect() as connection:
        return connection.execute(
            text("SELECT * FROM money_requests WHERE id = :id"), {"id": request_id}
        ).one()


def _snapshot(engine: Engine) -> Any:
    with engine.connect() as connection:
        return connection.execute(
            text(
                "SELECT (SELECT array_agg(balance ORDER BY id) FROM accounts), "
                "(SELECT COUNT(*) FROM ledger_entries)"
            )
        ).one()


@pytest.fixture
def make(client: TestClient) -> Callable[[str], str]:
    """Crea una solicitud de Ana a Beto y la lleva por la API al estado pedido."""
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    assert deposit_request(client, beto.token, 100_000).status_code == 201

    def build(status: str) -> str:
        response = money_request_create(client, ana.token, beto.id, 1_000)
        request_id: str = response.json()["id"]
        actions: dict[str, tuple[CreatedAccount, str]] = {
            "ACCEPTED": (beto, "accept"),
            "REJECTED": (beto, "reject"),
            "CANCELLED": (ana, "cancel"),
        }
        if status in actions:
            actor, action = actions[status]
            headers = bearer(actor.token) | {"Idempotency-Key": str(uuid.uuid4())}
            done = client.post(f"/money-requests/{request_id}/{action}", headers=headers)
            assert done.status_code == 200, done.text
        return request_id

    return build


def _any_transfer(engine: Engine, exclude: object = None) -> uuid.UUID:
    with engine.connect() as connection:
        transaction_id: uuid.UUID = connection.execute(
            text(
                "SELECT id FROM ledger_transactions WHERE kind = 'TRANSFER' "
                "AND id IS DISTINCT FROM :exclude LIMIT 1"
            ),
            {"exclude": exclude},
        ).scalar_one()
    return transaction_id


def _assert_blocked(engine: Engine, request_id: str, sql: str, **params: object) -> None:
    before_row = _row(engine, request_id)
    before_money = _snapshot(engine)

    with pytest.raises(IntegrityError, match=GUARD):
        _sql(engine, sql, id=request_id, **params)

    assert _row(engine, request_id) == before_row
    assert _snapshot(engine) == before_money


# --- Estados finales ------------------------------------------------------------------------


@pytest.mark.parametrize("status", ["ACCEPTED", "REJECTED", "CANCELLED"])
def test_a_resolved_request_cannot_go_back_to_pending(
    db: Engine, make: Callable[[str], str], status: str
) -> None:
    request_id = make(status)

    _assert_blocked(
        db,
        request_id,
        "UPDATE money_requests SET status = 'PENDING', transaction_id = NULL, "
        "resolved_at = NULL WHERE id = :id",
    )


@pytest.mark.parametrize("target", ["REJECTED", "CANCELLED"])
def test_an_accepted_request_cannot_become_rejected_or_cancelled(
    db: Engine, make: Callable[[str], str], target: str
) -> None:
    request_id = make("ACCEPTED")

    # Con y sin su transferencia: el trigger lo rechaza antes que cualquier CHECK.
    for clear_transaction in (True, False):
        extra = ", transaction_id = NULL" if clear_transaction else ""
        _assert_blocked(
            db,
            request_id,
            f"UPDATE money_requests SET status = :target{extra} WHERE id = :id",
            target=target,
        )


@pytest.mark.parametrize("status", ["REJECTED", "CANCELLED"])
def test_a_rejected_or_cancelled_request_cannot_become_accepted(
    db: Engine, make: Callable[[str], str], status: str
) -> None:
    make("ACCEPTED")  # deja una transferencia real a la que intentar vincularla
    request_id = make(status)

    _assert_blocked(
        db,
        request_id,
        "UPDATE money_requests SET status = 'ACCEPTED', transaction_id = :tx WHERE id = :id",
        tx=_any_transfer(db),
    )


def test_the_transfer_of_an_accepted_request_cannot_be_changed(
    db: Engine, make: Callable[[str], str]
) -> None:
    request_id = make("ACCEPTED")
    own = _row(db, request_id).transaction_id
    with db.begin() as connection:  # otra transferencia real, sin solicitud asociada
        other = connection.execute(
            text(
                "INSERT INTO ledger_transactions (id, kind) "
                "VALUES (gen_random_uuid(), 'TRANSFER') RETURNING id"
            )
        ).scalar_one()

    _assert_blocked(
        db, request_id, "UPDATE money_requests SET transaction_id = :tx WHERE id = :id", tx=other
    )
    _assert_blocked(
        db, request_id, "UPDATE money_requests SET transaction_id = NULL WHERE id = :id"
    )
    assert _row(db, request_id).transaction_id == own


@pytest.mark.parametrize("status", ["ACCEPTED", "REJECTED", "CANCELLED"])
@pytest.mark.parametrize(
    "assignment",
    ["amount = amount + 1", "resolved_at = now() + interval '1 day'", "description = 'otra'"],
)
def test_no_column_of_a_resolved_request_can_change(
    db: Engine, make: Callable[[str], str], status: str, assignment: str
) -> None:
    request_id = make(status)

    _assert_blocked(db, request_id, f"UPDATE money_requests SET {assignment} WHERE id = :id")


@pytest.mark.parametrize("status", ["ACCEPTED", "REJECTED", "CANCELLED"])
def test_a_resolved_request_cannot_be_deleted(
    db: Engine, make: Callable[[str], str], status: str
) -> None:
    request_id = make(status)

    _assert_blocked(db, request_id, "DELETE FROM money_requests WHERE id = :id")


# --- Solicitudes pendientes -----------------------------------------------------------------


@pytest.mark.parametrize(
    "assignment",
    [
        "amount = amount * 2",
        "description = 'otra'",
        "created_at = now() - interval '1 day'",
        "payer_account_id = requester_account_id",
        "requester_account_id = payer_account_id",
    ],
)
def test_the_data_of_a_pending_request_cannot_change(
    db: Engine, make: Callable[[str], str], assignment: str
) -> None:
    """Lo único que le puede pasar a una solicitud pendiente es resolverse: ni el monto que se
    pagará ni las partes cambian mientras espera."""
    request_id = make("PENDING")

    _assert_blocked(db, request_id, f"UPDATE money_requests SET {assignment} WHERE id = :id")


@pytest.mark.parametrize("target", ["REJECTED", "CANCELLED"])
def test_a_pending_request_can_still_be_resolved_in_the_database(
    db: Engine, make: Callable[[str], str], target: str
) -> None:
    request_id = make("PENDING")

    _sql(
        db,
        "UPDATE money_requests SET status = :target, resolved_at = now() WHERE id = :id",
        id=request_id,
        target=target,
    )

    assert _row(db, request_id).status == target


def test_the_normal_flows_still_work(
    client: TestClient, db: Engine, make: Callable[[str], str]
) -> None:
    """Crear, aceptar, rechazar y cancelar por la API siguen funcionando con el trigger."""
    statuses = {status: make(status) for status in ("PENDING", "ACCEPTED", "REJECTED", "CANCELLED")}

    for status, request_id in statuses.items():
        assert _row(db, request_id).status == status
    assert _row(db, statuses["ACCEPTED"]).transaction_id is not None
    assert_ledger_is_consistent(db)


# --- Migración ------------------------------------------------------------------------------


def test_guard_downgrade_only_removes_the_protection(
    db: Engine, make: Callable[[str], str]
) -> None:
    """Revertir quita el trigger sin tocar datos, y volver a aplicar lo restaura."""
    request_id = make("ACCEPTED")
    row_before = _row(db, request_id)
    money_before = _snapshot(db)
    config = alembic_config()

    command.downgrade(config, BEFORE_GUARD)
    try:
        assert _row(db, request_id) == row_before
        assert _snapshot(db) == money_before
        # Sin el trigger, la BD vuelve a aceptar lo que la migración prohíbe.
        _sql(
            db, "UPDATE money_requests SET description = 'sin guarda' WHERE id = :id", id=request_id
        )
        _sql(db, "UPDATE money_requests SET description = NULL WHERE id = :id", id=request_id)
    finally:
        command.upgrade(config, "head")

    assert _row(db, request_id) == row_before
    _assert_blocked(db, request_id, "UPDATE money_requests SET description = 'x' WHERE id = :id")
    assert_ledger_is_consistent(db)
