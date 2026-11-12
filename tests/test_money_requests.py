"""Solicitudes de dinero: crear, listar y consultar. Crear no mueve dinero, la cuenta propia
sale del token y nadie ve solicitudes ni saldos ajenos (requiere PostgreSQL)."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from habicapital.accounts.models import FUNDING_ACCOUNT_ID
from habicapital.ledger.service import MAX_TRANSFER_COP
from tests.conftest import (
    CreatedAccount,
    assert_ledger_is_consistent,
    bearer,
    create_account,
    deposit_request,
    money_request_create,
    money_request_get,
    money_requests_list,
)

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("db")]

READ_FIELDS = {
    "id",
    "requester",
    "payer",
    "amount",
    "description",
    "status",
    "transaction_id",
    "created_at",
    "resolved_at",
}
PARTY_FIELDS = {"account_id", "owner_name"}


def _count(engine: Engine, sql: str) -> int:
    with engine.connect() as connection:
        count: int = connection.execute(text(sql)).scalar_one()
    return count


def _balance(client: TestClient, account: CreatedAccount) -> int:
    response = client.get("/accounts/me", headers=bearer(account.token))
    assert response.status_code == 200
    balance: int = response.json()["balance"]
    return balance


def _requests(engine: Engine) -> int:
    return _count(engine, "SELECT COUNT(*) FROM money_requests")


def _ledger_rows(engine: Engine) -> tuple[int, int]:
    return (
        _count(engine, "SELECT COUNT(*) FROM ledger_transactions"),
        _count(engine, "SELECT COUNT(*) FROM ledger_entries"),
    )


def _create(
    client: TestClient, requester: CreatedAccount, payer: CreatedAccount, amount: int
) -> Any:
    response = money_request_create(client, requester.token, payer.id, amount)
    assert response.status_code == 201, response.text
    return response.json()


def _assert_only_public_fields(body: dict[str, Any]) -> None:
    """Nada de saldos ni otros datos privados: solo los campos públicos de la solicitud."""
    assert set(body) == READ_FIELDS
    assert set(body["requester"]) == PARTY_FIELDS
    assert set(body["payer"]) == PARTY_FIELDS


# --- Crear ----------------------------------------------------------------------------------


def test_create_returns_a_pending_request_and_moves_no_money(
    client: TestClient, db: Engine
) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    assert deposit_request(client, beto.token, 50_000).status_code == 201
    ledger_before = _ledger_rows(db)

    response = money_request_create(client, ana.token, beto.id, 12_000, description="  Cena  ")

    assert response.status_code == 201
    body = response.json()
    _assert_only_public_fields(body)
    assert body["requester"] == {"account_id": ana.id, "owner_name": "Ana"}
    assert body["payer"] == {"account_id": beto.id, "owner_name": "Beto"}
    assert body["amount"] == 12_000
    assert body["description"] == "Cena"
    assert body["status"] == "PENDING"
    assert body["transaction_id"] is None
    assert body["resolved_at"] is None
    assert body["created_at"]
    # Ni un peso se movió: mismos saldos, ni una fila nueva en el ledger.
    assert _balance(client, ana) == 0
    assert _balance(client, beto) == 50_000
    assert _ledger_rows(db) == ledger_before
    assert _requests(db) == 1
    assert_ledger_is_consistent(db)


def test_create_is_allowed_even_if_the_payer_has_no_money(client: TestClient, db: Engine) -> None:
    """No se valida el saldo del pagador: hacerlo revelaría su saldo al solicitante."""
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")

    response = money_request_create(client, ana.token, beto.id, MAX_TRANSFER_COP)

    assert response.status_code == 201
    assert response.json()["amount"] == MAX_TRANSFER_COP
    assert _ledger_rows(db) == (0, 0)


def test_requester_always_comes_from_the_token(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    carla = create_account(client, "Carla")

    # El body no puede traer el solicitante: cualquier campo extra se rechaza.
    for field in ("requester_account_id", "requester", "account_id"):
        response = client.post(
            "/money-requests",
            json={"payer_account_id": beto.id, "amount": 1_000, field: carla.id},
            headers=bearer(ana.token) | {"Idempotency-Key": str(uuid.uuid4())},
        )
        assert response.status_code == 422, field
    assert _requests(db) == 0

    body = _create(client, ana, beto, 1_000)
    assert body["requester"]["account_id"] == ana.id


def test_request_to_own_account_is_rejected(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")

    response = money_request_create(client, ana.token, ana.id, 1_000)

    assert response.status_code == 422
    assert response.json() == {"detail": "No puedes solicitarte dinero a ti mismo"}
    assert _requests(db) == 0


@pytest.mark.parametrize(
    "payer_id", [str(uuid.uuid4()), str(FUNDING_ACCOUNT_ID)], ids=["inexistente", "funding"]
)
def test_unknown_or_system_payer_is_not_found(
    client: TestClient, db: Engine, payer_id: str
) -> None:
    """FUNDING responde igual que una cuenta inexistente: no se le pueden pedir pesos."""
    ana = create_account(client, "Ana")

    response = money_request_create(client, ana.token, payer_id, 1_000)

    assert response.status_code == 404
    assert response.json() == {"detail": "Cuenta destinataria no encontrada"}
    assert _requests(db) == 0


@pytest.mark.parametrize("amount", [0, -1, 1.5, "1000", True, None, MAX_TRANSFER_COP + 1], ids=repr)
def test_invalid_amount_is_rejected(client: TestClient, db: Engine, amount: object) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")

    response = money_request_create(client, ana.token, beto.id, amount)

    assert response.status_code == 422
    assert _requests(db) == 0


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"amount": 1_000},
        {"payer_account_id": "no-es-un-uuid", "amount": 1_000},
        {"payer_account_id": "PAYER", "amount": 1_000, "description": "x" * 141},
        {"payer_account_id": "PAYER", "amount": 1_000, "description": "   "},
        {"payer_account_id": "PAYER", "amount": 1_000, "status": "ACCEPTED"},
    ],
    ids=[
        "vacio",
        "sin-pagador",
        "uuid-invalido",
        "descripcion-larga",
        "descripcion-vacia",
        "estado",
    ],
)
def test_invalid_body_is_rejected(client: TestClient, db: Engine, body: dict[str, Any]) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    body = {k: (beto.id if v == "PAYER" else v) for k, v in body.items()}

    response = client.post(
        "/money-requests",
        json=body,
        headers=bearer(ana.token) | {"Idempotency-Key": str(uuid.uuid4())},
    )

    assert response.status_code == 422
    assert _requests(db) == 0


@pytest.mark.parametrize("key", [None, "", "con espacios", "x" * 101], ids=repr)
def test_create_requires_a_valid_idempotency_key(
    client: TestClient, db: Engine, key: str | None
) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    headers = bearer(ana.token) if key is None else bearer(ana.token) | {"Idempotency-Key": key}

    response = client.post(
        "/money-requests", json={"payer_account_id": beto.id, "amount": 1_000}, headers=headers
    )

    assert response.status_code == 422
    assert _requests(db) == 0


@pytest.mark.parametrize("token", [None, "token-inventado"], ids=["sin-token", "token-invalido"])
def test_create_requires_a_valid_token(client: TestClient, db: Engine, token: str | None) -> None:
    beto = create_account(client, "Beto")
    headers = {"Idempotency-Key": "k1"} | ({} if token is None else bearer(token))

    response = client.post(
        "/money-requests", json={"payer_account_id": beto.id, "amount": 1_000}, headers=headers
    )

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
    assert _requests(db) == 0


# --- Idempotencia al crear ------------------------------------------------------------------


def test_retry_with_the_same_key_replays_without_a_second_request(
    client: TestClient, db: Engine
) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")

    first = money_request_create(client, ana.token, beto.id, 5_000, key="pedido-1")
    retry = money_request_create(client, ana.token, beto.id, 5_000, key="pedido-1")

    assert first.status_code == retry.status_code == 201
    assert "Idempotent-Replayed" not in first.headers
    assert retry.headers["Idempotent-Replayed"] == "true"
    assert retry.json() == first.json()
    assert _requests(db) == 1


def test_same_key_with_a_different_body_is_rejected(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    assert money_request_create(client, ana.token, beto.id, 5_000, key="k").status_code == 201

    response = money_request_create(client, ana.token, beto.id, 6_000, key="k")

    assert response.status_code == 422
    assert response.json() == {"detail": "La Idempotency-Key ya se usó con una solicitud distinta"}
    assert _requests(db) == 1


def test_key_used_by_another_operation_is_rejected(client: TestClient, db: Engine) -> None:
    """La misma clave de un depósito no sirve para crear una solicitud (otra operación)."""
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    assert deposit_request(client, ana.token, 5_000, key="compartida").status_code == 201

    response = money_request_create(client, ana.token, beto.id, 5_000, key="compartida")

    assert response.status_code == 422
    assert _requests(db) == 0


def test_keys_are_scoped_per_account(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")

    first = money_request_create(client, ana.token, beto.id, 1_000, key="misma")
    second = money_request_create(client, beto.token, ana.id, 1_000, key="misma")

    assert first.status_code == second.status_code == 201
    assert first.json()["id"] != second.json()["id"]
    assert _requests(db) == 2


def test_rejected_creation_does_not_consume_the_key(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    assert money_request_create(client, ana.token, ana.id, 1_000, key="k").status_code == 422

    response = money_request_create(client, ana.token, beto.id, 1_000, key="k")

    assert response.status_code == 201
    assert "Idempotent-Replayed" not in response.headers


def test_concurrent_creates_with_the_same_key_create_one_request(
    client: TestClient, db: Engine
) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")

    def send(_: int) -> tuple[int, str]:
        response = money_request_create(client, ana.token, beto.id, 2_000, key="doble-clic")
        return response.status_code, response.json()["id"]

    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(send, range(10)))

    assert {status for status, _ in results} == {201}
    assert len({request_id for _, request_id in results}) == 1
    assert _requests(db) == 1
    assert _ledger_rows(db) == (0, 0)


# --- Consultar una solicitud ----------------------------------------------------------------


def test_both_parties_can_read_the_request(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    created = _create(client, ana, beto, 3_000)

    for account in (ana, beto):
        response = money_request_get(client, account.token, created["id"])
        assert response.status_code == 200
        assert response.json() == created
        _assert_only_public_fields(response.json())


def test_third_parties_cannot_read_the_request(client: TestClient, db: Engine) -> None:
    """Un tercero recibe el mismo 404 que con un id inexistente: no confirma que existe."""
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    carla = create_account(client, "Carla")
    created = _create(client, ana, beto, 3_000)

    foreign = money_request_get(client, carla.token, created["id"])
    missing = money_request_get(client, carla.token, uuid.uuid4())

    assert foreign.status_code == missing.status_code == 404
    assert foreign.json() == missing.json() == {"detail": "Solicitud no encontrada"}


def test_read_with_an_invalid_id_is_rejected(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")

    assert money_request_get(client, ana.token, "no-es-un-uuid").status_code == 422


@pytest.mark.parametrize("token", [None, "token-inventado"], ids=["sin-token", "token-invalido"])
def test_read_requires_a_valid_token(client: TestClient, db: Engine, token: str | None) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    created = _create(client, ana, beto, 3_000)
    headers = {} if token is None else bearer(token)

    response = client.get(f"/money-requests/{created['id']}", headers=headers)

    assert response.status_code == 401


# --- Listar ---------------------------------------------------------------------------------


def _ids(response: Any) -> list[str]:
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


def test_list_separates_sent_and_received_and_isolates_accounts(
    client: TestClient, db: Engine
) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    carla = create_account(client, "Carla")
    dario = create_account(client, "Darío")
    ana_to_beto = _create(client, ana, beto, 1_000)["id"]
    ana_to_carla = _create(client, ana, carla, 2_000)["id"]
    beto_to_ana = _create(client, beto, ana, 3_000)["id"]

    assert set(_ids(money_requests_list(client, ana.token, role="sent"))) == {
        ana_to_beto,
        ana_to_carla,
    }
    assert _ids(money_requests_list(client, ana.token, role="received")) == [beto_to_ana]
    assert _ids(money_requests_list(client, beto.token, role="sent")) == [beto_to_ana]
    # Beto no ve la solicitud de Ana a Carla.
    assert _ids(money_requests_list(client, beto.token, role="received")) == [ana_to_beto]
    assert _ids(money_requests_list(client, carla.token, role="sent")) == []
    assert _ids(money_requests_list(client, carla.token, role="received")) == [ana_to_carla]
    for role in ("sent", "received"):
        response = money_requests_list(client, dario.token, role=role)
        assert _ids(response) == []
        assert response.json()["total"] == 0


def test_list_items_expose_no_balances(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    assert deposit_request(client, beto.token, 7_654_321).status_code == 201
    assert deposit_request(client, ana.token, 1_234_567).status_code == 201
    _create(client, ana, beto, 1_000)

    for account, role in ((ana, "sent"), (beto, "received")):
        response = money_requests_list(client, account.token, role=role)
        assert response.status_code == 200
        assert "7654321" not in response.text
        assert "1234567" not in response.text
        assert "balance" not in response.text
        for item in response.json()["items"]:
            _assert_only_public_fields(item)


def test_list_paginates_and_orders(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    created = [_create(client, ana, beto, 1_000 + i)["id"] for i in range(5)]

    default = money_requests_list(client, ana.token, role="sent")
    assert _ids(default) == list(reversed(created))
    assert default.json() | {"items": None} == {
        "items": None,
        "total": 5,
        "limit": 20,
        "offset": 0,
        "order": "desc",
        "role": "sent",
        "status": None,
    }

    pages = [
        _ids(money_requests_list(client, ana.token, role="sent", limit=2, offset=offset))
        for offset in (0, 2, 4)
    ]
    assert pages == [created[4:2:-1], created[2:0:-1], created[0:1]]

    ascending = money_requests_list(client, ana.token, role="sent", order="asc", limit=3, offset=1)
    assert _ids(ascending) == created[1:4]
    assert ascending.json()["total"] == 5

    beyond = money_requests_list(client, ana.token, role="sent", offset=10)
    assert _ids(beyond) == []
    assert beyond.json()["total"] == 5


def test_list_filters_by_status(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    pending = _create(client, ana, beto, 1_000)["id"]
    cancelled = _create(client, ana, beto, 2_000)["id"]
    # Cancelar aún no existe en la API: se simula directamente en la BD.
    with db.begin() as connection:
        connection.execute(
            text(
                "UPDATE money_requests SET status = 'CANCELLED', resolved_at = now() WHERE id = :id"
            ),
            {"id": cancelled},
        )

    only_pending = money_requests_list(client, ana.token, role="sent", status="PENDING")
    only_cancelled = money_requests_list(client, beto.token, role="received", status="CANCELLED")
    none_accepted = money_requests_list(client, ana.token, role="sent", status="ACCEPTED")

    assert _ids(only_pending) == [pending]
    assert only_pending.json()["total"] == 1
    assert only_pending.json()["status"] == "PENDING"
    assert _ids(only_cancelled) == [cancelled]
    assert only_cancelled.json()["items"][0]["resolved_at"] is not None
    assert _ids(none_accepted) == []
    assert none_accepted.json()["total"] == 0
    assert len(_ids(money_requests_list(client, ana.token, role="sent"))) == 2


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"role": "all"},
        {"role": "sent", "status": "EXPIRED"},
        {"role": "sent", "status": "pending"},
        {"role": "sent", "limit": 0},
        {"role": "sent", "limit": 101},
        {"role": "sent", "offset": -1},
        {"role": "sent", "offset": 1_000_001},
        {"role": "sent", "order": "random"},
    ],
    ids=repr,
)
def test_list_rejects_invalid_parameters(
    client: TestClient, db: Engine, params: dict[str, object]
) -> None:
    ana = create_account(client, "Ana")

    assert money_requests_list(client, ana.token, **params).status_code == 422


def test_list_accepts_the_limits(client: TestClient, db: Engine) -> None:
    ana = create_account(client, "Ana")

    for params in ({"limit": 1}, {"limit": 100}, {"offset": 1_000_000}):
        response = money_requests_list(client, ana.token, role="received", **params)
        assert response.status_code == 200


@pytest.mark.parametrize("token", [None, "token-inventado"], ids=["sin-token", "token-invalido"])
def test_list_requires_a_valid_token(client: TestClient, db: Engine, token: str | None) -> None:
    headers = {} if token is None else bearer(token)

    response = client.get("/money-requests", params={"role": "sent"}, headers=headers)

    assert response.status_code == 401
