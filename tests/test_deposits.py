"""Depósitos simulados: doble partida, validación, idempotencia, atomicidad y concurrencia
(requiere PostgreSQL)."""

import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import IntegrityError

from habicapital.accounts.models import FUNDING_ACCOUNT_ID
from habicapital.idempotency import service as idempotency_service
from habicapital.ledger.service import MAX_DEPOSIT_COP
from habicapital.main import create_app
from tests.conftest import (
    assert_ledger_is_consistent,
    bearer,
    create_account,
    deposit_request,
)

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("db")]


def _balance(client: TestClient, token: str) -> int:
    response = client.get("/accounts/me", headers=bearer(token))
    assert response.status_code == 200
    balance: int = response.json()["balance"]
    return balance


def _count(engine: Engine, table: str) -> int:
    with engine.connect() as connection:
        count: int = connection.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar_one()
    return count


def _funding_balance(engine: Engine) -> int:
    with engine.connect() as connection:
        balance: int = connection.execute(
            text("SELECT balance FROM accounts WHERE id = :id"), {"id": FUNDING_ACCOUNT_ID}
        ).scalar_one()
    return balance


# --- Camino feliz y doble partida -------------------------------------------------------------


def test_deposit_credits_the_account_and_debits_funding(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")

    response = deposit_request(client, ana.token, 50_000, description="  Mesada  ")

    assert response.status_code == 201
    body = response.json()
    assert set(body) == {"transaction_id", "amount", "description", "balance", "created_at"}
    assert body["amount"] == 50_000
    assert body["balance"] == 50_000
    assert body["description"] == "Mesada"
    assert _balance(client, ana.token) == 50_000
    assert _funding_balance(db) == -50_000
    assert _count(db, "ledger_transactions") == 1
    assert _count(db, "ledger_entries") == 2
    assert_ledger_is_consistent(db)


def test_successive_deposits_accumulate(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")

    for amount in (1, 2_500, 97_499):
        assert deposit_request(client, ana.token, amount).status_code == 201

    assert _balance(client, ana.token) == 100_000
    assert_ledger_is_consistent(db)


def test_maximum_deposit_is_accepted(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")

    assert deposit_request(client, ana.token, MAX_DEPOSIT_COP).status_code == 201
    assert_ledger_is_consistent(db)


def test_a_deposit_only_changes_the_authenticated_account(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")

    deposit_request(client, ana.token, 10_000)

    assert _balance(client, ana.token) == 10_000
    assert _balance(client, beto.token) == 0
    assert_ledger_is_consistent(db)


# --- Validación: el dinero solo entra como entero positivo de pesos ---------------------------


@pytest.mark.parametrize(
    "amount",
    [0, -1, -50_000, 100.5, 100.0, "100", True, None, MAX_DEPOSIT_COP + 1, 2**63],
)
def test_invalid_amounts_are_rejected_and_nothing_is_recorded(
    client: TestClient, db: Engine, amount: object
) -> None:
    ana = create_account(client, "Ana")

    response = deposit_request(client, ana.token, amount)

    assert response.status_code == 422
    assert _balance(client, ana.token) == 0
    assert _count(db, "ledger_entries") == 0


@pytest.mark.parametrize(
    "body", [{}, {"amount": 100, "extra": 1}, {"amount": 100, "description": "x" * 141}]
)
def test_invalid_bodies_are_rejected(client: TestClient, body: dict[str, object]) -> None:
    ana = create_account(client, "Ana")
    headers = bearer(ana.token) | {"Idempotency-Key": "k-1"}

    assert client.post("/accounts/me/deposits", json=body, headers=headers).status_code == 422


@pytest.mark.parametrize("key", [None, "", "con espacio", "x" * 101])
def test_a_valid_idempotency_key_is_required(client: TestClient, key: str | None) -> None:
    ana = create_account(client, "Ana")
    headers = bearer(ana.token)
    if key is not None:
        headers["Idempotency-Key"] = key

    response = client.post("/accounts/me/deposits", json={"amount": 100}, headers=headers)

    assert response.status_code == 422
    assert _balance(client, ana.token) == 0


def test_deposit_requires_authentication(client: TestClient) -> None:
    response = client.post(
        "/accounts/me/deposits", json={"amount": 100}, headers={"Idempotency-Key": "k-1"}
    )

    assert response.status_code == 401


# --- Idempotencia ---------------------------------------------------------------------------


def test_retrying_with_the_same_key_replays_without_moving_money(
    client: TestClient, db: Engine
) -> None:
    ana = create_account(client, "Ana")

    first = deposit_request(client, ana.token, 30_000, key="cumple-ana")
    retry = deposit_request(client, ana.token, 30_000, key="cumple-ana")

    assert first.status_code == retry.status_code == 201
    assert retry.json() == first.json()
    assert "Idempotent-Replayed" not in first.headers
    assert retry.headers["Idempotent-Replayed"] == "true"
    assert _balance(client, ana.token) == 30_000
    assert _count(db, "ledger_transactions") == 1
    assert _count(db, "idempotency_records") == 1
    assert_ledger_is_consistent(db)


def test_reusing_a_key_for_a_different_request_is_rejected(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")
    deposit_request(client, ana.token, 30_000, key="k-1")

    response = deposit_request(client, ana.token, 99_000, key="k-1")

    assert response.status_code == 422
    assert "Idempotency-Key" in response.json()["detail"]
    assert _balance(client, ana.token) == 30_000
    assert_ledger_is_consistent(db)


def test_the_same_key_in_different_accounts_does_not_collide(client: TestClient) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")

    assert deposit_request(client, ana.token, 1_000, key="k-1").status_code == 201
    assert deposit_request(client, beto.token, 2_000, key="k-1").status_code == 201

    assert _balance(client, ana.token) == 1_000
    assert _balance(client, beto.token) == 2_000


def test_concurrent_requests_with_the_same_key_deposit_once(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")

    def send(_: int) -> tuple[int, str]:
        response = deposit_request(client, ana.token, 5_000, key="doble-clic")
        return response.status_code, response.json()["transaction_id"]

    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(send, range(10)))

    assert {status for status, _ in results} == {201}
    assert len({transaction_id for _, transaction_id in results}) == 1
    assert _balance(client, ana.token) == 5_000
    assert _count(db, "ledger_transactions") == 1
    assert_ledger_is_consistent(db)


# --- Concurrencia y atomicidad ----------------------------------------------------------------


def test_concurrent_deposits_are_never_lost(client: TestClient, db: Engine) -> None:
    """Sin bloqueo de filas (o con un saldo leído antes del bloqueo) se perderían depósitos."""
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    requests = [(ana.token, 1_000)] * 15 + [(beto.token, 3_000)] * 15

    with ThreadPoolExecutor(max_workers=10) as pool:
        statuses = list(pool.map(lambda r: deposit_request(client, *r).status_code, requests))

    assert statuses == [201] * 30
    assert _balance(client, ana.token) == 15_000
    assert _balance(client, beto.token) == 45_000
    assert _funding_balance(db) == -60_000
    assert _count(db, "ledger_transactions") == 30
    assert_ledger_is_consistent(db)


def test_a_failure_mid_operation_leaves_no_trace(
    client: TestClient, db: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Los asientos y saldos ya se escribieron (flush) cuando falla el registro de
    idempotencia: el rollback debe deshacer todo."""
    ana = create_account(client, "Ana")

    def failing_insert(*_args: object, **_kwargs: object) -> object:
        raise RuntimeError("fallo simulado al guardar el registro de idempotencia")

    monkeypatch.setattr(idempotency_service, "insert", failing_insert)

    with TestClient(create_app(), raise_server_exceptions=False) as failing_client:
        response = deposit_request(failing_client, ana.token, 40_000)

    assert response.status_code == 500
    assert _balance(client, ana.token) == 0
    assert _count(db, "ledger_transactions") == 0
    assert _count(db, "ledger_entries") == 0
    assert _count(db, "idempotency_records") == 0
    assert _funding_balance(db) == 0
    assert_ledger_is_consistent(db)


# --- Defensas en la BD ----------------------------------------------------------------------


def test_the_database_rejects_a_negative_user_balance(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")

    with pytest.raises(IntegrityError), db.begin() as connection:
        connection.execute(
            text("UPDATE accounts SET balance = -1 WHERE id = :id"), {"id": uuid.UUID(ana.id)}
        )


def test_the_funding_account_exists_and_cannot_authenticate(db: Engine) -> None:
    with db.connect() as connection:
        row = connection.execute(
            text("SELECT kind, token_hash FROM accounts WHERE id = :id"),
            {"id": FUNDING_ACCOUNT_ID},
        ).one()

    assert row.kind == "SYSTEM"
    assert row.token_hash is None


def test_the_database_rejects_a_user_without_token_or_a_system_account_with_one(
    db: Engine,
) -> None:
    for kind, token_hash in (("USER", None), ("SYSTEM", "a" * 64)):
        with pytest.raises(IntegrityError), db.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO accounts (id, kind, owner_name, token_hash, balance) "
                    "VALUES (gen_random_uuid(), :kind, 'X', :hash, 0)"
                ),
                {"kind": kind, "hash": token_hash},
            )
