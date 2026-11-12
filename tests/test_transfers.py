"""Transferencias entre usuarios: doble partida, validación, idempotencia, concurrencia y
atomicidad (requiere PostgreSQL)."""

import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from habicapital.accounts.models import FUNDING_ACCOUNT_ID
from habicapital.idempotency import service as idempotency_service
from habicapital.ledger.service import MAX_TRANSFER_COP
from habicapital.main import create_app
from tests.conftest import (
    CreatedAccount,
    assert_ledger_is_consistent,
    bearer,
    create_account,
    deposit_request,
    transfer_request,
)

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("db")]


def _balance(client: TestClient, account: CreatedAccount) -> int:
    response = client.get("/accounts/me", headers=bearer(account.token))
    assert response.status_code == 200
    balance: int = response.json()["balance"]
    return balance


def _count(engine: Engine, sql: str) -> int:
    with engine.connect() as connection:
        count: int = connection.execute(text(sql)).scalar_one()
    return count


def _funded(client: TestClient, name: str, amount: int) -> CreatedAccount:
    account = create_account(client, name)
    if amount:
        assert deposit_request(client, account.token, amount).status_code == 201
    return account


def _transactions(engine: Engine) -> int:
    return _count(engine, "SELECT COUNT(*) FROM ledger_transactions WHERE kind = 'TRANSFER'")


# --- Camino feliz ---------------------------------------------------------------------------


def test_transfer_moves_money_between_users(client: TestClient, db: Engine) -> None:
    ana = _funded(client, "Ana", 100_000)
    beto = _funded(client, "Beto", 0)

    response = transfer_request(client, ana.token, beto.id, 30_000, description="  Arriendo  ")

    assert response.status_code == 201
    body = response.json()
    assert set(body) == {
        "transaction_id",
        "to_account_id",
        "amount",
        "description",
        "balance",
        "created_at",
    }
    assert body["to_account_id"] == beto.id
    assert body["amount"] == 30_000
    assert body["balance"] == 70_000  # saldo del emisor; el del receptor no se expone
    assert body["description"] == "Arriendo"
    assert _balance(client, ana) == 70_000
    assert _balance(client, beto) == 30_000
    assert _transactions(db) == 1
    entries = _count(
        db,
        "SELECT COUNT(*) FROM ledger_entries e JOIN ledger_transactions t "
        "ON t.id = e.transaction_id WHERE t.kind = 'TRANSFER'",
    )
    assert entries == 2
    funding = _count(db, f"SELECT balance FROM accounts WHERE id = '{FUNDING_ACCOUNT_ID}'")
    assert funding == -100_000  # FUNDING no participa en transferencias
    assert_ledger_is_consistent(db)


def test_the_whole_balance_can_be_transferred(client: TestClient, db: Engine) -> None:
    ana = _funded(client, "Ana", 50_000)
    beto = _funded(client, "Beto", 0)

    assert transfer_request(client, ana.token, beto.id, 50_000).status_code == 201

    assert _balance(client, ana) == 0
    assert _balance(client, beto) == 50_000
    assert_ledger_is_consistent(db)


def test_maximum_transfer_is_accepted(client: TestClient, db: Engine) -> None:
    ana = _funded(client, "Ana", MAX_TRANSFER_COP)
    beto = _funded(client, "Beto", 0)

    assert transfer_request(client, ana.token, beto.id, MAX_TRANSFER_COP).status_code == 201
    assert_ledger_is_consistent(db)


# --- Errores: nada queda registrado ---------------------------------------------------------


def _assert_nothing_moved(
    client: TestClient, db: Engine, ana: CreatedAccount, beto: CreatedAccount, ana_balance: int
) -> None:
    assert _balance(client, ana) == ana_balance
    assert _balance(client, beto) == 0
    assert _transactions(db) == 0
    assert_ledger_is_consistent(db)


def test_transfer_requires_authentication(client: TestClient, db: Engine) -> None:
    ana = _funded(client, "Ana", 10_000)
    beto = _funded(client, "Beto", 0)
    body = {"to_account_id": beto.id, "amount": 1_000}

    without_token = client.post(
        "/accounts/me/transfers", json=body, headers={"Idempotency-Key": "k-1"}
    )
    bad_token = client.post(
        "/accounts/me/transfers",
        json=body,
        headers=bearer("token-invalido") | {"Idempotency-Key": "k-2"},
    )

    assert without_token.status_code == 401
    assert bad_token.status_code == 401
    _assert_nothing_moved(client, db, ana, beto, 10_000)


@pytest.mark.parametrize(
    "amount", [0, -1, 100.5, 100.0, "100", True, None, MAX_TRANSFER_COP + 1, 2**63]
)
def test_invalid_amounts_are_rejected(client: TestClient, db: Engine, amount: object) -> None:
    ana = _funded(client, "Ana", 10_000)
    beto = _funded(client, "Beto", 0)

    assert transfer_request(client, ana.token, beto.id, amount).status_code == 422
    _assert_nothing_moved(client, db, ana, beto, 10_000)


@pytest.mark.parametrize(
    "extra", [{"from_account_id": "otro"}, {"extra": 1}, {"description": "x" * 141}]
)
def test_invalid_bodies_are_rejected_including_a_chosen_origin(
    client: TestClient, db: Engine, extra: dict[str, object]
) -> None:
    """El origen nunca viene del cliente: un campo from_account_id se rechaza."""
    ana = _funded(client, "Ana", 10_000)
    beto = _funded(client, "Beto", 0)
    body: dict[str, object] = {"to_account_id": beto.id, "amount": 1_000} | extra

    response = client.post(
        "/accounts/me/transfers", json=body, headers=bearer(ana.token) | {"Idempotency-Key": "k"}
    )

    assert response.status_code == 422
    _assert_nothing_moved(client, db, ana, beto, 10_000)


@pytest.mark.parametrize("to_account_id", ["no-es-un-uuid", 123, None])
def test_malformed_destination_is_rejected(
    client: TestClient, db: Engine, to_account_id: object
) -> None:
    ana = _funded(client, "Ana", 10_000)
    beto = _funded(client, "Beto", 0)

    assert transfer_request(client, ana.token, to_account_id, 1_000).status_code == 422
    _assert_nothing_moved(client, db, ana, beto, 10_000)


@pytest.mark.parametrize("key", [None, "", "con espacio", "x" * 101])
def test_a_valid_idempotency_key_is_required(
    client: TestClient, db: Engine, key: str | None
) -> None:
    ana = _funded(client, "Ana", 10_000)
    beto = _funded(client, "Beto", 0)
    headers = bearer(ana.token)
    if key is not None:
        headers["Idempotency-Key"] = key

    response = client.post(
        "/accounts/me/transfers", json={"to_account_id": beto.id, "amount": 1_000}, headers=headers
    )

    assert response.status_code == 422
    _assert_nothing_moved(client, db, ana, beto, 10_000)


def test_transferring_to_yourself_is_rejected(client: TestClient, db: Engine) -> None:
    ana = _funded(client, "Ana", 10_000)

    response = transfer_request(client, ana.token, ana.id, 1_000)

    assert response.status_code == 422
    assert response.json() == {"detail": "No puedes transferirte a tu propia cuenta"}
    assert _balance(client, ana) == 10_000
    assert _transactions(db) == 0


@pytest.mark.parametrize("destination", [str(uuid.uuid4()), str(FUNDING_ACCOUNT_ID)])
def test_unknown_or_system_destinations_are_not_found(
    client: TestClient, db: Engine, destination: str
) -> None:
    ana = _funded(client, "Ana", 10_000)

    response = transfer_request(client, ana.token, destination, 1_000)

    assert response.status_code == 404
    assert response.json() == {"detail": "Cuenta de destino no encontrada"}
    assert _balance(client, ana) == 10_000
    assert _transactions(db) == 0
    assert_ledger_is_consistent(db)


def test_insufficient_funds_are_rejected(client: TestClient, db: Engine) -> None:
    ana = _funded(client, "Ana", 10_000)
    beto = _funded(client, "Beto", 0)

    response = transfer_request(client, ana.token, beto.id, 10_001)

    assert response.status_code == 409
    assert response.json() == {"detail": "Saldo insuficiente"}
    _assert_nothing_moved(client, db, ana, beto, 10_000)


def test_a_user_without_balance_cannot_transfer(client: TestClient, db: Engine) -> None:
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 0)

    assert transfer_request(client, ana.token, beto.id, 1).status_code == 409
    _assert_nothing_moved(client, db, ana, beto, 0)


# --- Idempotencia ---------------------------------------------------------------------------


def test_retrying_with_the_same_key_replays_without_moving_money(
    client: TestClient, db: Engine
) -> None:
    ana = _funded(client, "Ana", 100_000)
    beto = _funded(client, "Beto", 0)

    first = transfer_request(client, ana.token, beto.id, 25_000, key="arriendo-nov")
    retry = transfer_request(client, ana.token, beto.id, 25_000, key="arriendo-nov")

    assert first.status_code == retry.status_code == 201
    assert retry.json() == first.json()
    assert retry.headers["Idempotent-Replayed"] == "true"
    assert _balance(client, ana) == 75_000
    assert _balance(client, beto) == 25_000
    assert _transactions(db) == 1
    assert_ledger_is_consistent(db)


@pytest.mark.parametrize("change", ["amount", "destination"])
def test_reusing_a_key_for_a_different_transfer_is_rejected(
    client: TestClient, db: Engine, change: str
) -> None:
    ana = _funded(client, "Ana", 100_000)
    beto = _funded(client, "Beto", 0)
    carla = _funded(client, "Carla", 0)
    transfer_request(client, ana.token, beto.id, 10_000, key="k-1")

    destination, amount = (beto.id, 99) if change == "amount" else (carla.id, 10_000)
    response = transfer_request(client, ana.token, destination, amount, key="k-1")

    assert response.status_code == 422
    assert _balance(client, ana) == 90_000
    assert _balance(client, carla) == 0
    assert _transactions(db) == 1


def test_a_key_used_for_a_deposit_cannot_be_reused_for_a_transfer(
    client: TestClient, db: Engine
) -> None:
    ana = create_account(client, "Ana")
    beto = _funded(client, "Beto", 0)
    assert deposit_request(client, ana.token, 50_000, key="misma-clave").status_code == 201

    response = transfer_request(client, ana.token, beto.id, 1_000, key="misma-clave")

    assert response.status_code == 422
    assert _balance(client, ana) == 50_000
    assert _transactions(db) == 0


def test_an_insufficient_funds_rejection_does_not_consume_the_key(
    client: TestClient, db: Engine
) -> None:
    ana = _funded(client, "Ana", 1_000)
    beto = _funded(client, "Beto", 0)

    rejected = transfer_request(client, ana.token, beto.id, 5_000, key="pago-1")
    deposit_request(client, ana.token, 4_000)
    retried = transfer_request(client, ana.token, beto.id, 5_000, key="pago-1")

    assert rejected.status_code == 409
    assert retried.status_code == 201
    assert "Idempotent-Replayed" not in retried.headers
    assert _balance(client, ana) == 0
    assert _balance(client, beto) == 5_000
    assert_ledger_is_consistent(db)


def test_concurrent_requests_with_the_same_key_transfer_once(
    client: TestClient, db: Engine
) -> None:
    ana = _funded(client, "Ana", 100_000)
    beto = _funded(client, "Beto", 0)

    def send(_: int) -> tuple[int, str]:
        response = transfer_request(client, ana.token, beto.id, 7_000, key="doble-clic")
        return response.status_code, response.json()["transaction_id"]

    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(send, range(10)))

    assert {status for status, _ in results} == {201}
    assert len({transaction_id for _, transaction_id in results}) == 1
    assert _balance(client, ana) == 93_000
    assert _balance(client, beto) == 7_000
    assert _transactions(db) == 1
    assert_ledger_is_consistent(db)


# --- Concurrencia ---------------------------------------------------------------------------


def test_concurrent_transfers_cannot_double_spend(client: TestClient, db: Engine) -> None:
    """Con 5.000 de saldo, de 10 transferencias simultáneas de 1.000 solo pueden pasar 5."""
    ana = _funded(client, "Ana", 5_000)
    beto = _funded(client, "Beto", 0)

    with ThreadPoolExecutor(max_workers=10) as pool:
        statuses = list(
            pool.map(
                lambda _: transfer_request(client, ana.token, beto.id, 1_000).status_code, range(10)
            )
        )

    assert sorted(statuses) == [201] * 5 + [409] * 5
    assert _balance(client, ana) == 0
    assert _balance(client, beto) == 5_000
    assert _transactions(db) == 5
    assert_ledger_is_consistent(db)


def test_crossed_concurrent_transfers_do_not_deadlock(client: TestClient, db: Engine) -> None:
    """A→B y B→A a la vez: sin un orden fijo de bloqueo, PostgreSQL detectaría deadlocks."""
    ana = _funded(client, "Ana", 100_000)
    beto = _funded(client, "Beto", 100_000)
    requests = [(ana.token, beto.id), (beto.token, ana.id)] * 15

    with ThreadPoolExecutor(max_workers=10) as pool:
        statuses = list(
            pool.map(lambda r: transfer_request(client, r[0], r[1], 1_000).status_code, requests)
        )

    assert statuses == [201] * 30
    assert _balance(client, ana) == 100_000
    assert _balance(client, beto) == 100_000
    assert _transactions(db) == 30
    assert_ledger_is_consistent(db)


def test_many_senders_to_one_recipient_lose_no_credit(client: TestClient, db: Engine) -> None:
    senders = [_funded(client, f"Emisor {i}", 10_000) for i in range(5)]
    carla = _funded(client, "Carla", 0)
    requests = [sender for sender in senders for _ in range(4)]

    with ThreadPoolExecutor(max_workers=10) as pool:
        statuses = list(
            pool.map(
                lambda s: transfer_request(client, s.token, carla.id, 2_500).status_code, requests
            )
        )

    assert statuses == [201] * 20
    assert _balance(client, carla) == 50_000
    assert all(_balance(client, sender) == 0 for sender in senders)
    assert_ledger_is_consistent(db)


# --- Atomicidad -----------------------------------------------------------------------------


def test_a_failure_mid_transfer_leaves_no_trace(
    client: TestClient, db: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Débito, crédito y asientos ya están escritos (flush) cuando falla el registro de
    idempotencia: el rollback debe deshacerlo todo."""
    ana = _funded(client, "Ana", 40_000)
    beto = _funded(client, "Beto", 0)
    records_before = _count(db, "SELECT COUNT(*) FROM idempotency_records")

    def failing_insert(*_args: object, **_kwargs: object) -> object:
        raise RuntimeError("fallo simulado al guardar el registro de idempotencia")

    monkeypatch.setattr(idempotency_service, "insert", failing_insert)

    with TestClient(create_app(), raise_server_exceptions=False) as failing_client:
        response = transfer_request(failing_client, ana.token, beto.id, 15_000)

    assert response.status_code == 500
    _assert_nothing_moved(client, db, ana, beto, 40_000)
    assert _count(db, "SELECT COUNT(*) FROM idempotency_records") == records_before
