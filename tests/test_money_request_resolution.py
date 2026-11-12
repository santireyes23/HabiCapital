"""Rechazar y cancelar solicitudes: permisos, una sola resolución, concurrencia y que nunca se
mueva un peso (requiere PostgreSQL)."""

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import Engine, text

from tests.conftest import (
    CreatedAccount,
    assert_ledger_is_consistent,
    bearer,
    create_account,
    deposit_request,
    money_request_create,
    money_request_get,
    transfer_request,
)

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("db")]

NOT_FOUND = {"detail": "Solicitud no encontrada"}
NOT_PENDING = {"detail": "La solicitud ya no está pendiente"}
FINAL_STATUS = {"reject": "REJECTED", "cancel": "CANCELLED"}


def _resolve(client: TestClient, token: str, request_id: object, action: str) -> Response:
    response: Response = client.post(
        f"/money-requests/{request_id}/{action}", headers=bearer(token)
    )
    return response


def _snapshot(engine: Engine) -> dict[str, Any]:
    """Todo lo que representa dinero: saldos, transacciones y asientos."""
    with engine.connect() as connection:
        rows = connection.execute(text("SELECT id::text, balance FROM accounts")).all()
        balances: dict[str, int] = {row[0]: row[1] for row in rows}
        transactions = connection.execute(text("SELECT COUNT(*) FROM ledger_transactions"))
        entries = connection.execute(text("SELECT COUNT(*) FROM ledger_entries"))
        return {
            "balances": balances,
            "transactions": transactions.scalar_one(),
            "entries": entries.scalar_one(),
        }


def _status(engine: Engine, request_id: str) -> str:
    with engine.connect() as connection:
        status: str = connection.execute(
            text("SELECT status FROM money_requests WHERE id = :id"), {"id": request_id}
        ).scalar_one()
    return status


def _funded(client: TestClient, name: str, amount: int) -> CreatedAccount:
    account = create_account(client, name)
    assert deposit_request(client, account.token, amount).status_code == 201
    return account


def _pending(client: TestClient, requester: CreatedAccount, payer: CreatedAccount) -> str:
    response = money_request_create(client, requester.token, payer.id, 4_000)
    assert response.status_code == 201
    request_id: str = response.json()["id"]
    return request_id


@pytest.fixture
def parties(client: TestClient) -> tuple[CreatedAccount, CreatedAccount, CreatedAccount]:
    """Ana pide, Beto paga, Carla es un tercero. Todos con saldo, para ver que no cambia."""
    ana = _funded(client, "Ana", 10_000)
    beto = _funded(client, "Beto", 20_000)
    carla = _funded(client, "Carla", 30_000)
    assert transfer_request(client, beto.token, ana.id, 1_500).status_code == 201
    return ana, beto, carla


Parties = tuple[CreatedAccount, CreatedAccount, CreatedAccount]


# --- Camino feliz ---------------------------------------------------------------------------


@pytest.mark.parametrize(("action", "actor"), [("reject", "payer"), ("cancel", "requester")])
def test_resolution_closes_the_request_and_moves_no_money(
    client: TestClient, db: Engine, parties: Parties, action: str, actor: str
) -> None:
    ana, beto, _ = parties
    created = money_request_create(client, ana.token, beto.id, 4_000, description="Cena").json()
    before = _snapshot(db)
    token = beto.token if actor == "payer" else ana.token

    response = _resolve(client, token, created["id"], action)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == FINAL_STATUS[action]
    assert body["transaction_id"] is None
    assert body["resolved_at"] is not None
    assert datetime.fromisoformat(body["resolved_at"]) >= datetime.fromisoformat(body["created_at"])
    # Lo demás no cambia.
    assert {k: body[k] for k in ("id", "requester", "payer", "amount", "description")} == {
        k: created[k] for k in ("id", "requester", "payer", "amount", "description")
    }
    # Ambas partes ven el nuevo estado.
    for account in (ana, beto):
        assert money_request_get(client, account.token, created["id"]).json() == body
    # Ni un peso se movió.
    assert _snapshot(db) == before
    assert_ledger_is_consistent(db)


# --- Permisos -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("action", "intruder"),
    [
        ("reject", "requester"),  # el solicitante no puede rechazar su propia solicitud
        ("reject", "third"),
        ("cancel", "payer"),  # el pagador no puede cancelarla (para eso está rechazar)
        ("cancel", "third"),
    ],
)
def test_wrong_user_gets_not_found_and_nothing_changes(
    client: TestClient, db: Engine, parties: Parties, action: str, intruder: str
) -> None:
    ana, beto, carla = parties
    request_id = _pending(client, ana, beto)
    before = _snapshot(db)
    token = {"requester": ana.token, "payer": beto.token, "third": carla.token}[intruder]

    response = _resolve(client, token, request_id, action)

    assert response.status_code == 404
    assert response.json() == NOT_FOUND
    assert _status(db, request_id) == "PENDING"
    assert _snapshot(db) == before


@pytest.mark.parametrize("action", ["reject", "cancel"])
def test_unknown_request_is_not_found(client: TestClient, parties: Parties, action: str) -> None:
    ana, beto, _ = parties

    for account in (ana, beto):
        response = _resolve(client, account.token, uuid.uuid4(), action)
        assert response.status_code == 404
        assert response.json() == NOT_FOUND


@pytest.mark.parametrize("action", ["reject", "cancel"])
def test_invalid_request_id_is_rejected(client: TestClient, parties: Parties, action: str) -> None:
    ana, _, _ = parties

    assert _resolve(client, ana.token, "no-es-un-uuid", action).status_code == 422


@pytest.mark.parametrize("action", ["reject", "cancel"])
@pytest.mark.parametrize("token", [None, "token-inventado"], ids=["sin-token", "token-invalido"])
def test_resolution_requires_a_valid_token(
    client: TestClient, db: Engine, parties: Parties, action: str, token: str | None
) -> None:
    ana, beto, _ = parties
    request_id = _pending(client, ana, beto)
    headers = {} if token is None else bearer(token)

    response = client.post(f"/money-requests/{request_id}/{action}", headers=headers)

    assert response.status_code == 401
    assert _status(db, request_id) == "PENDING"


# --- Una sola resolución --------------------------------------------------------------------


@pytest.mark.parametrize("first", ["reject", "cancel"])
@pytest.mark.parametrize("second", ["reject", "cancel"])
def test_a_resolved_request_cannot_be_resolved_again(
    client: TestClient, db: Engine, parties: Parties, first: str, second: str
) -> None:
    """Cubre la operación repetida (reject+reject, cancel+cancel) y la cruzada."""
    ana, beto, _ = parties
    request_id = _pending(client, ana, beto)
    actor = {"reject": beto, "cancel": ana}
    assert _resolve(client, actor[first].token, request_id, first).status_code == 200
    resolved = money_request_get(client, ana.token, request_id).json()
    before = _snapshot(db)

    response = _resolve(client, actor[second].token, request_id, second)

    assert response.status_code == 409
    assert response.json() == NOT_PENDING
    # El primer resultado queda intacto, incluida su fecha de resolución.
    assert money_request_get(client, ana.token, request_id).json() == resolved
    assert _status(db, request_id) == FINAL_STATUS[first]
    assert _snapshot(db) == before


@pytest.mark.parametrize("action", ["reject", "cancel"])
def test_accepted_request_cannot_be_rejected_or_cancelled(
    client: TestClient, db: Engine, parties: Parties, action: str
) -> None:
    """Aceptar aún no existe en la API: se simula una solicitud ya aceptada en la BD."""
    ana, beto, _ = parties
    request_id = _pending(client, ana, beto)
    with db.begin() as connection:
        transaction_id = connection.execute(
            text("SELECT id FROM ledger_transactions WHERE kind = 'TRANSFER' LIMIT 1")
        ).scalar_one()
        connection.execute(
            text(
                "UPDATE money_requests SET status = 'ACCEPTED', transaction_id = :tx, "
                "resolved_at = now() WHERE id = :id"
            ),
            {"tx": transaction_id, "id": request_id},
        )
    before = _snapshot(db)
    actor = beto if action == "reject" else ana

    response = _resolve(client, actor.token, request_id, action)

    assert response.status_code == 409
    assert response.json() == NOT_PENDING
    assert _status(db, request_id) == "ACCEPTED"
    assert _snapshot(db) == before


def test_resolving_one_request_does_not_touch_the_others(
    client: TestClient, db: Engine, parties: Parties
) -> None:
    ana, beto, carla = parties
    target = _pending(client, ana, beto)
    same_pair = _pending(client, ana, beto)
    other_payer = _pending(client, ana, carla)

    assert _resolve(client, beto.token, target, "reject").status_code == 200

    assert _status(db, target) == "REJECTED"
    assert _status(db, same_pair) == "PENDING"
    assert _status(db, other_payer) == "PENDING"


# --- Concurrencia ---------------------------------------------------------------------------


@pytest.mark.parametrize("action", ["reject", "cancel"])
def test_concurrent_identical_resolutions_succeed_once(
    client: TestClient, db: Engine, parties: Parties, action: str
) -> None:
    ana, beto, _ = parties
    request_id = _pending(client, ana, beto)
    before = _snapshot(db)
    token = beto.token if action == "reject" else ana.token
    barrier = threading.Barrier(10)

    def send(_: int) -> int:
        barrier.wait()
        return _resolve(client, token, request_id, action).status_code

    with ThreadPoolExecutor(max_workers=10) as pool:
        statuses = list(pool.map(send, range(10)))

    assert sorted(statuses) == [200] + [409] * 9
    assert _status(db, request_id) == FINAL_STATUS[action]
    assert _snapshot(db) == before
    assert_ledger_is_consistent(db)


def test_concurrent_reject_and_cancel_have_exactly_one_winner(
    client: TestClient, db: Engine, parties: Parties
) -> None:
    """El pagador rechaza mientras el solicitante cancela, en muchas solicitudes a la vez: cada
    una termina en el estado de la única operación que respondió 200."""
    ana, beto, _ = parties
    request_ids = [_pending(client, ana, beto) for _ in range(15)]
    before = _snapshot(db)
    jobs = [(rid, action) for rid in request_ids for action in ("reject", "cancel")]
    barrier = threading.Barrier(len(jobs))

    def send(job: tuple[str, str]) -> tuple[str, str, int]:
        request_id, action = job
        token = beto.token if action == "reject" else ana.token
        barrier.wait()
        return request_id, action, _resolve(client, token, request_id, action).status_code

    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        results = list(pool.map(send, jobs))

    for request_id in request_ids:
        outcomes = {action: status for rid, action, status in results if rid == request_id}
        assert sorted(outcomes.values()) == [200, 409], outcomes
        winner = next(action for action, status in outcomes.items() if status == 200)
        assert _status(db, request_id) == FINAL_STATUS[winner]
    assert _snapshot(db) == before
    assert_ledger_is_consistent(db)


def test_resolutions_run_alongside_money_movements_without_interference(
    client: TestClient, db: Engine, parties: Parties
) -> None:
    """Resolver solicitudes no bloquea cuentas: transferencias y depósitos simultáneos entre
    las mismas personas terminan bien y cuadran."""
    ana, beto, _ = parties
    request_ids = [_pending(client, ana, beto) for _ in range(5)]
    beto_before = 20_000 - 1_500

    def work(index: int) -> int:
        if index < 5:
            return _resolve(client, beto.token, request_ids[index], "reject").status_code
        if index < 10:
            return transfer_request(client, beto.token, ana.id, 100).status_code
        return deposit_request(client, ana.token, 50).status_code

    with ThreadPoolExecutor(max_workers=15) as pool:
        statuses = list(pool.map(work, range(15)))

    assert statuses[:5] == [200] * 5
    assert statuses[5:] == [201] * 10
    assert all(_status(db, rid) == "REJECTED" for rid in request_ids)
    balances = _snapshot(db)["balances"]
    assert balances[beto.id] == beto_before - 500
    assert balances[ana.id] == 10_000 + 1_500 + 500 + 250
    assert_ledger_is_consistent(db)
