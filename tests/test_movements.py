"""Historial de movimientos: contenido, conciliación con el ledger, orden, paginación,
aislamiento entre cuentas y lecturas concurrentes (requiere PostgreSQL)."""

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from habicapital.accounts.models import FUNDING_ACCOUNT_ID
from tests.conftest import (
    CreatedAccount,
    assert_ledger_is_consistent,
    bearer,
    create_account,
    deposit_request,
    movements_request,
    transfer_request,
)

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("db")]

MOVEMENT_FIELDS = {
    "transaction_id",
    "type",
    "direction",
    "amount",
    "balance_after",
    "description",
    "counterparty",
    "created_at",
}


def _page(client: TestClient, account: CreatedAccount, **params: object) -> dict[str, Any]:
    response = movements_request(client, account.token, **params)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _all(client: TestClient, account: CreatedAccount, order: str = "desc") -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = _page(client, account, limit=100, order=order)["items"]
    return items


def _balance(client: TestClient, account: CreatedAccount) -> int:
    balance: int = client.get("/accounts/me", headers=bearer(account.token)).json()["balance"]
    return balance


def _deposit(client: TestClient, account: CreatedAccount, amount: int, **kw: Any) -> str:
    response = deposit_request(client, account.token, amount, **kw)
    assert response.status_code == 201, response.text
    transaction_id: str = response.json()["transaction_id"]
    return transaction_id


def _transfer(
    client: TestClient, src: CreatedAccount, dst: CreatedAccount, amount: int, **kw: Any
) -> str:
    response = transfer_request(client, src.token, dst.id, amount, **kw)
    assert response.status_code == 201, response.text
    transaction_id: str = response.json()["transaction_id"]
    return transaction_id


def _signed(item: dict[str, Any]) -> int:
    amount: int = item["amount"]
    return amount if item["direction"] == "IN" else -amount


# --- Contenido ------------------------------------------------------------------------------


def test_a_new_account_has_an_empty_history(client: TestClient) -> None:
    ana = create_account(client, "Ana")

    body = _page(client, ana)

    assert body == {"items": [], "total": 0, "limit": 20, "offset": 0, "order": "desc"}


def test_a_deposit_appears_as_incoming_without_counterparty(client: TestClient) -> None:
    ana = create_account(client, "Ana")
    transaction_id = _deposit(client, ana, 100_000, description="Mesada")

    (item,) = _all(client, ana)

    assert set(item) == MOVEMENT_FIELDS
    assert item["transaction_id"] == transaction_id
    assert item["type"] == "DEPOSIT"
    assert item["direction"] == "IN"
    assert item["amount"] == 100_000
    assert item["balance_after"] == 100_000
    assert item["description"] == "Mesada"
    assert item["counterparty"] is None  # FUNDING nunca se muestra


def test_a_transfer_appears_on_both_sides_with_the_same_transaction(client: TestClient) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    _deposit(client, ana, 100_000)
    transaction_id = _transfer(client, ana, beto, 25_000, description="Arriendo")

    sent = _all(client, ana)[0]
    (received,) = _all(client, beto)

    assert sent["transaction_id"] == received["transaction_id"] == transaction_id
    assert (sent["type"], sent["direction"]) == ("TRANSFER_SENT", "OUT")
    assert (received["type"], received["direction"]) == ("TRANSFER_RECEIVED", "IN")
    assert sent["amount"] == received["amount"] == 25_000
    assert sent["balance_after"] == 75_000
    assert received["balance_after"] == 25_000
    assert sent["description"] == received["description"] == "Arriendo"
    assert sent["counterparty"] == {"account_id": beto.id, "owner_name": "Beto"}
    assert received["counterparty"] == {"account_id": ana.id, "owner_name": "Ana"}


def test_the_counterparty_exposes_only_id_and_name(client: TestClient) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    _deposit(client, beto, 999_999)
    _deposit(client, ana, 10_000)
    _transfer(client, ana, beto, 1_000)

    response = movements_request(client, ana.token, limit=100)
    (counterparty,) = [i["counterparty"] for i in response.json()["items"] if i["counterparty"]]

    assert set(counterparty) == {"account_id", "owner_name"}
    # El saldo de Beto (1.000.999) no aparece en ningún lado de la respuesta de Ana.
    assert "1000999" not in response.text
    assert beto.token not in response.text


# --- Conciliación con el ledger -------------------------------------------------------------


def _mixed_activity(client: TestClient) -> tuple[CreatedAccount, CreatedAccount, CreatedAccount]:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    carla = create_account(client, "Carla")
    _deposit(client, ana, 80_000)
    _deposit(client, beto, 30_000)
    _transfer(client, ana, beto, 12_500)
    _transfer(client, beto, ana, 4_000)
    _transfer(client, beto, carla, 7_000)
    _deposit(client, ana, 1)
    _transfer(client, ana, carla, 50_000)
    return ana, beto, carla


def test_history_reconciles_with_the_balance(client: TestClient, db: Engine) -> None:
    for account in _mixed_activity(client):
        history = _all(client, account)
        balance = _balance(client, account)

        assert sum(_signed(item) for item in history) == balance
        assert history[0]["balance_after"] == balance
        assert all(item["amount"] > 0 for item in history)
    assert_ledger_is_consistent(db)


def test_balance_after_follows_each_movement_in_chronological_order(client: TestClient) -> None:
    for account in _mixed_activity(client):
        previous = 0
        for item in _all(client, account, order="asc"):
            assert item["balance_after"] == previous + _signed(item)
            previous = item["balance_after"]


def test_rejected_operations_do_not_appear(client: TestClient) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    _deposit(client, ana, 1_000)

    assert transfer_request(client, ana.token, beto.id, 5_000).status_code == 409
    assert transfer_request(client, ana.token, ana.id, 100).status_code == 422
    assert transfer_request(client, ana.token, str(uuid.uuid4()), 100).status_code == 404
    assert transfer_request(client, ana.token, str(FUNDING_ACCOUNT_ID), 100).status_code == 404
    assert deposit_request(client, ana.token, 0).status_code == 422

    assert _page(client, ana)["total"] == 1
    assert _page(client, beto)["total"] == 0


def test_idempotent_retries_do_not_duplicate_movements(client: TestClient) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    for _ in range(3):
        deposit_request(client, ana.token, 10_000, key="dep-1")
        transfer_request(client, ana.token, beto.id, 2_000, key="tr-1")

    assert _page(client, ana)["total"] == 2
    assert _page(client, beto)["total"] == 1


# --- Orden y paginación ---------------------------------------------------------------------


def _with_movements(client: TestClient, count: int) -> tuple[CreatedAccount, list[str]]:
    ana = create_account(client, "Ana")
    ids = [
        _deposit(client, ana, amount, description=f"d{amount}") for amount in range(1, count + 1)
    ]
    return ana, ids


def test_default_order_is_most_recent_first_and_asc_reverses_it(client: TestClient) -> None:
    ana, ids = _with_movements(client, 5)

    desc = [item["transaction_id"] for item in _all(client, ana)]
    asc = [item["transaction_id"] for item in _all(client, ana, order="asc")]

    assert desc == list(reversed(ids))
    assert asc == ids
    assert _page(client, ana)["order"] == "desc"


@pytest.mark.parametrize("order", ["desc", "asc"])
def test_walking_all_pages_returns_every_movement_once(client: TestClient, order: str) -> None:
    ana, ids = _with_movements(client, 10)
    seen: list[str] = []

    for offset in range(0, 12, 3):
        body = _page(client, ana, limit=3, offset=offset, order=order)
        assert body["total"] == 10
        assert (body["limit"], body["offset"]) == (3, offset)
        seen.extend(item["transaction_id"] for item in body["items"])

    assert len(seen) == 10
    assert sorted(seen) == sorted(ids)
    assert seen == (ids if order == "asc" else list(reversed(ids)))


def test_an_offset_past_the_end_returns_no_items_but_the_real_total(client: TestClient) -> None:
    ana, _ = _with_movements(client, 4)

    body = _page(client, ana, limit=10, offset=50)

    assert body["items"] == []
    assert body["total"] == 4


def test_limit_caps_the_page_at_100(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")
    # 101 depósitos directos en la BD (más rápido que 101 peticiones), cuadrados como en el ledger.
    with db.begin() as connection:
        for i in range(1, 102):
            tx = uuid.uuid4()
            connection.execute(
                text("INSERT INTO ledger_transactions (id, kind) VALUES (:id, 'DEPOSIT')"),
                {"id": tx},
            )
            connection.execute(
                text(
                    "INSERT INTO ledger_entries (transaction_id, account_id, amount, balance_after)"
                    " VALUES (:tx, :funding, -1, :neg), (:tx, :ana, 1, :pos)"
                ),
                {"tx": tx, "funding": FUNDING_ACCOUNT_ID, "ana": ana.id, "neg": -i, "pos": i},
            )
        connection.execute(text("UPDATE accounts SET balance = 101 WHERE id = :id"), {"id": ana.id})
        connection.execute(
            text("UPDATE accounts SET balance = -101 WHERE id = :id"), {"id": FUNDING_ACCOUNT_ID}
        )

    body = _page(client, ana, limit=100)

    assert len(body["items"]) == 100
    assert body["total"] == 101
    assert body["items"][0]["balance_after"] == 101
    assert_ledger_is_consistent(db)


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": 101},
        {"limit": -1},
        {"limit": "abc"},
        {"limit": 1.5},
        {"offset": -1},
        {"offset": 1_000_001},
        {"offset": "x"},
        {"order": "newest"},
        {"order": "DESC"},
    ],
)
def test_invalid_query_parameters_are_rejected(
    client: TestClient, params: dict[str, object]
) -> None:
    ana = create_account(client, "Ana")

    assert movements_request(client, ana.token, **params).status_code == 422


# --- Seguridad ------------------------------------------------------------------------------


def test_history_requires_authentication(client: TestClient) -> None:
    assert client.get("/accounts/me/movements").status_code == 401
    assert client.get("/accounts/me/movements", headers=bearer("token-falso")).status_code == 401


def test_each_account_only_sees_its_own_movements(client: TestClient, db: Engine) -> None:
    ana, beto, carla = _mixed_activity(client)
    outsider = create_account(client, "Diego")

    for account in (ana, beto, carla):
        history = _all(client, account)
        with db.connect() as connection:
            own = connection.execute(
                text("SELECT COUNT(*) FROM ledger_entries WHERE account_id = :id"),
                {"id": account.id},
            ).scalar_one()
        assert len(history) == own
        # Cada movimiento es de esta cuenta: ninguna contraparte es ella misma.
        assert all(
            item["counterparty"] is None or item["counterparty"]["account_id"] != account.id
            for item in history
        )

    # Los movimientos entre Beto y Carla no aparecen en el historial de Ana, ni nada en el de Diego.
    carla_ids = {item["transaction_id"] for item in _all(client, carla)}
    beto_to_carla = {
        item["transaction_id"]
        for item in _all(client, beto)
        if item["counterparty"] and item["counterparty"]["account_id"] == carla.id
    }
    ana_ids = {item["transaction_id"] for item in _all(client, ana)}
    assert beto_to_carla <= carla_ids
    assert not beto_to_carla & ana_ids
    assert _page(client, outsider)["total"] == 0


def test_funding_never_appears_as_counterparty(client: TestClient) -> None:
    ana, beto, carla = _mixed_activity(client)

    for account in (ana, beto, carla):
        for item in _all(client, account):
            if item["counterparty"] is not None:
                assert item["counterparty"]["account_id"] != str(FUNDING_ACCOUNT_ID)
            assert (item["type"] == "DEPOSIT") == (item["counterparty"] is None)


# --- Concurrencia ---------------------------------------------------------------------------


def test_reading_history_during_concurrent_transfers_is_consistent(
    client: TestClient, db: Engine
) -> None:
    """Página y total salen de la misma instantánea: con limit=100 y menos de 100 movimientos,
    la página trae exactamente `total` elementos y siempre concilia, aunque se lea a mitad de
    30 transferencias cruzadas."""
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    _deposit(client, ana, 100_000)
    _deposit(client, beto, 100_000)
    writes = [(ana.token, beto.id), (beto.token, ana.id)] * 15
    done = threading.Event()
    problems: list[str] = []

    def write(pair: tuple[str, str]) -> int:
        return transfer_request(client, pair[0], pair[1], 1_000).status_code

    def read(account: CreatedAccount) -> int:
        reads = 0
        while not done.is_set() or reads == 0:
            response = movements_request(client, account.token, limit=100)
            if response.status_code != 200:
                problems.append(f"status {response.status_code}")
                break
            body = response.json()
            if len(body["items"]) != body["total"]:
                problems.append(f"página {len(body['items'])} != total {body['total']}")
            items = body["items"]
            if items and sum(_signed(i) for i in items) != items[0]["balance_after"]:
                problems.append("la página no concilia con balance_after")
            reads += 1
        return reads

    with ThreadPoolExecutor(max_workers=8) as pool:
        readers = [pool.submit(read, account) for account in (ana, beto, ana, beto)]
        statuses = list(pool.map(write, writes))
        done.set()
        reads = sum(reader.result() for reader in readers)

    assert statuses == [201] * 30
    assert problems == []
    assert reads >= 4
    for account in (ana, beto):
        assert _page(client, account)["total"] == 31
        assert sum(_signed(i) for i in _all(client, account)) == _balance(client, account)
    assert_ledger_is_consistent(db)
