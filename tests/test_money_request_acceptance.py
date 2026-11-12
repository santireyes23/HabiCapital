"""Aceptar solicitudes de dinero: el único camino de las solicitudes que mueve plata.

Cubre la transferencia real (con el servicio de transferencias existente), la atomicidad del
pago + cambio de estado + registro de idempotencia, la idempotencia (incluida la respuesta
perdida) y las carreras con otras aceptaciones, rechazos y cancelaciones (requiere PostgreSQL).
"""

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import Engine, text

from habicapital.db import get_sessionmaker
from habicapital.errors import InsufficientFundsError
from habicapital.idempotency import service as idempotency_service
from habicapital.ledger import service as ledger_service
from habicapital.main import create_app
from tests.conftest import (
    CreatedAccount,
    assert_ledger_is_consistent,
    bearer,
    create_account,
    deposit_request,
    money_request_create,
    money_request_get,
    movements_request,
    transfer_request,
)

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("db")]

NOT_FOUND = {"detail": "Solicitud no encontrada"}
NOT_PENDING = {"detail": "La solicitud ya no está pendiente"}
INSUFFICIENT = {"detail": "Saldo insuficiente"}
KEY_REUSED = {"detail": "La Idempotency-Key ya se usó con una solicitud distinta"}
FINAL_STATUS = {"accept": "ACCEPTED", "reject": "REJECTED", "cancel": "CANCELLED"}


# --- Helpers --------------------------------------------------------------------------------


def _accept(client: TestClient, token: str, request_id: object, key: str | None = None) -> Response:
    headers = bearer(token) | {"Idempotency-Key": key or str(uuid.uuid4())}
    response: Response = client.post(f"/money-requests/{request_id}/accept", headers=headers)
    return response


def _resolve(client: TestClient, token: str, request_id: object, action: str) -> Response:
    if action == "accept":
        return _accept(client, token, request_id)
    response: Response = client.post(
        f"/money-requests/{request_id}/{action}", headers=bearer(token)
    )
    return response


def _funded(client: TestClient, name: str, amount: int) -> CreatedAccount:
    account = create_account(client, name)
    if amount:
        assert deposit_request(client, account.token, amount).status_code == 201
    return account


def _pending(
    client: TestClient,
    requester: CreatedAccount,
    payer: CreatedAccount,
    amount: int = 4_000,
    description: str | None = None,
) -> str:
    response = money_request_create(
        client, requester.token, payer.id, amount, description=description
    )
    assert response.status_code == 201, response.text
    request_id: str = response.json()["id"]
    return request_id


def _scalar(engine: Engine, sql: str, **params: object) -> Any:
    with engine.connect() as connection:
        return connection.execute(text(sql), params).scalar_one()


def _balance(engine: Engine, account: CreatedAccount) -> int:
    balance: int = _scalar(engine, "SELECT balance FROM accounts WHERE id = :id", id=account.id)
    return balance


def _transfers(engine: Engine) -> int:
    count: int = _scalar(engine, "SELECT COUNT(*) FROM ledger_transactions WHERE kind = 'TRANSFER'")
    return count


def _row(engine: Engine, request_id: str) -> Any:
    with engine.connect() as connection:
        return connection.execute(
            text("SELECT status, transaction_id, resolved_at FROM money_requests WHERE id = :id"),
            {"id": request_id},
        ).one()


def _snapshot(engine: Engine) -> dict[str, Any]:
    """Todo lo que representa dinero, más los registros de idempotencia."""
    with engine.connect() as connection:
        rows = connection.execute(text("SELECT id::text, balance FROM accounts")).all()
        counts = connection.execute(
            text(
                "SELECT (SELECT COUNT(*) FROM ledger_transactions), "
                "(SELECT COUNT(*) FROM ledger_entries), "
                "(SELECT COUNT(*) FROM idempotency_records)"
            )
        ).one()
    balances: dict[str, int] = {row[0]: row[1] for row in rows}
    return {"balances": balances, "ledger_and_keys": tuple(counts)}


def _assert_untouched(engine: Engine, request_id: str, before: dict[str, Any]) -> None:
    row = _row(engine, request_id)
    assert row.status == "PENDING"
    assert row.transaction_id is None
    assert row.resolved_at is None
    assert _snapshot(engine) == before
    assert_ledger_is_consistent(engine)


# --- Camino feliz ---------------------------------------------------------------------------


def test_accept_transfers_the_amount_and_closes_the_request(client: TestClient, db: Engine) -> None:
    ana = _funded(client, "Ana", 1_000)
    beto = _funded(client, "Beto", 10_000)
    request_id = _pending(client, ana, beto, 4_000, description="Cena")

    response = _accept(client, beto.token, request_id)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ACCEPTED"
    assert body["transaction_id"] is not None
    assert body["resolved_at"] is not None
    assert body["amount"] == 4_000
    assert body["requester"] == {"account_id": ana.id, "owner_name": "Ana"}
    assert body["payer"] == {"account_id": beto.id, "owner_name": "Beto"}
    assert body["balance"] == 6_000  # saldo del pagador, que es quien llama
    assert "Idempotent-Replayed" not in response.headers
    assert _balance(db, ana) == 5_000
    assert _balance(db, beto) == 6_000

    # La solicitud guarda la transferencia que la saldó, y es una TRANSFER normal del ledger.
    row = _row(db, request_id)
    assert str(row.transaction_id) == body["transaction_id"]
    with db.connect() as connection:
        kind, description = connection.execute(
            text("SELECT kind, description FROM ledger_transactions WHERE id = :id"),
            {"id": row.transaction_id},
        ).one()
        rows = connection.execute(
            text("SELECT account_id::text, amount FROM ledger_entries WHERE transaction_id = :id"),
            {"id": row.transaction_id},
        ).all()
    legs: dict[str, int] = {leg[0]: leg[1] for leg in rows}
    assert (kind, description) == ("TRANSFER", "Cena")
    assert legs == {beto.id: -4_000, ana.id: 4_000}
    assert_ledger_is_consistent(db)


def test_both_parties_see_the_accepted_request_without_balances(
    client: TestClient, db: Engine
) -> None:
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 10_000)
    request_id = _pending(client, ana, beto)
    accepted = _accept(client, beto.token, request_id).json()

    for account in (ana, beto):
        body = money_request_get(client, account.token, request_id).json()
        assert "balance" not in body
        assert body == {k: v for k, v in accepted.items() if k != "balance"}


def test_accepted_request_appears_in_both_histories(client: TestClient, db: Engine) -> None:
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 10_000)
    request_id = _pending(client, ana, beto, 2_500, description="Arriendo")
    transaction_id = _accept(client, beto.token, request_id).json()["transaction_id"]

    sent = movements_request(client, beto.token).json()["items"][0]
    received = movements_request(client, ana.token).json()["items"][0]

    assert sent["transaction_id"] == received["transaction_id"] == transaction_id
    assert (sent["type"], sent["direction"], sent["amount"]) == ("TRANSFER_SENT", "OUT", 2_500)
    assert sent["balance_after"] == 7_500
    assert sent["counterparty"] == {"account_id": ana.id, "owner_name": "Ana"}
    assert (received["type"], received["direction"]) == ("TRANSFER_RECEIVED", "IN")
    assert received["balance_after"] == 2_500
    assert received["counterparty"] == {"account_id": beto.id, "owner_name": "Beto"}
    assert sent["description"] == received["description"] == "Arriendo"


def test_the_whole_balance_can_be_used_to_accept(client: TestClient, db: Engine) -> None:
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 4_000)
    request_id = _pending(client, ana, beto, 4_000)

    response = _accept(client, beto.token, request_id)

    assert response.status_code == 200
    assert response.json()["balance"] == 0
    assert _balance(db, ana) == 4_000
    assert_ledger_is_consistent(db)


# --- Saldo insuficiente ---------------------------------------------------------------------


@pytest.mark.parametrize("payer_balance", [0, 3_999])
def test_insufficient_funds_keep_the_request_pending(
    client: TestClient, db: Engine, payer_balance: int
) -> None:
    ana = _funded(client, "Ana", 1_000)
    beto = _funded(client, "Beto", payer_balance)
    request_id = _pending(client, ana, beto, 4_000)
    before = _snapshot(db)

    response = _accept(client, beto.token, request_id)

    assert response.status_code == 409
    assert response.json() == INSUFFICIENT
    _assert_untouched(db, request_id, before)


def test_insufficient_funds_do_not_consume_the_key(client: TestClient, db: Engine) -> None:
    """Tras el 409 la solicitud sigue PENDING; con saldo, la MISMA clave ya sirve para pagar."""
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 1_000)
    request_id = _pending(client, ana, beto, 4_000)
    assert _accept(client, beto.token, request_id, key="pagar").status_code == 409

    assert deposit_request(client, beto.token, 3_000).status_code == 201
    response = _accept(client, beto.token, request_id, key="pagar")

    assert response.status_code == 200
    assert "Idempotent-Replayed" not in response.headers
    assert response.json()["balance"] == 0
    assert _balance(db, ana) == 4_000
    assert_ledger_is_consistent(db)


# --- Permisos y solicitudes inválidas -------------------------------------------------------


@pytest.mark.parametrize("intruder", ["requester", "third"])
def test_only_the_payer_can_accept(client: TestClient, db: Engine, intruder: str) -> None:
    """El solicitante no puede "aceptar" su propia solicitud (se pagaría a sí mismo con plata
    del otro) y un tercero tampoco: ambos reciben el mismo 404 que una solicitud inexistente."""
    ana = _funded(client, "Ana", 10_000)
    beto = _funded(client, "Beto", 10_000)
    carla = _funded(client, "Carla", 10_000)
    request_id = _pending(client, ana, beto)
    before = _snapshot(db)
    token = ana.token if intruder == "requester" else carla.token

    response = _accept(client, token, request_id)

    assert response.status_code == 404
    assert response.json() == NOT_FOUND
    _assert_untouched(db, request_id, before)


def test_unknown_request_is_not_found(client: TestClient, db: Engine) -> None:
    beto = _funded(client, "Beto", 10_000)
    before = _snapshot(db)

    response = _accept(client, beto.token, uuid.uuid4())

    assert response.status_code == 404
    assert response.json() == NOT_FOUND
    assert _snapshot(db) == before


def test_invalid_request_id_is_rejected(client: TestClient, db: Engine) -> None:
    beto = _funded(client, "Beto", 10_000)

    assert _accept(client, beto.token, "no-es-un-uuid").status_code == 422


@pytest.mark.parametrize("key", [None, "", "con espacios", "x" * 101], ids=repr)
def test_accept_requires_a_valid_idempotency_key(
    client: TestClient, db: Engine, key: str | None
) -> None:
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 10_000)
    request_id = _pending(client, ana, beto)
    before = _snapshot(db)
    headers = bearer(beto.token) | ({} if key is None else {"Idempotency-Key": key})

    response = client.post(f"/money-requests/{request_id}/accept", headers=headers)

    assert response.status_code == 422
    _assert_untouched(db, request_id, before)


@pytest.mark.parametrize("token", [None, "token-inventado"], ids=["sin-token", "token-invalido"])
def test_accept_requires_a_valid_token(client: TestClient, db: Engine, token: str | None) -> None:
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 10_000)
    request_id = _pending(client, ana, beto)
    before = _snapshot(db)
    headers = {"Idempotency-Key": "k"} | ({} if token is None else bearer(token))

    response = client.post(f"/money-requests/{request_id}/accept", headers=headers)

    assert response.status_code == 401
    _assert_untouched(db, request_id, before)


@pytest.mark.parametrize("first", ["reject", "cancel"])
def test_a_closed_request_cannot_be_accepted(client: TestClient, db: Engine, first: str) -> None:
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 10_000)
    request_id = _pending(client, ana, beto)
    actor = beto if first == "reject" else ana
    assert _resolve(client, actor.token, request_id, first).status_code == 200
    before = _snapshot(db)

    response = _accept(client, beto.token, request_id)

    assert response.status_code == 409
    assert response.json() == NOT_PENDING
    assert _row(db, request_id).status == FINAL_STATUS[first]
    assert _snapshot(db) == before


def test_an_accepted_request_cannot_be_accepted_again_with_another_key(
    client: TestClient, db: Engine
) -> None:
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 10_000)
    request_id = _pending(client, ana, beto)
    first = _accept(client, beto.token, request_id, key="primera")
    assert first.status_code == 200
    before = _snapshot(db)

    second = _accept(client, beto.token, request_id, key="segunda")

    assert second.status_code == 409
    assert second.json() == NOT_PENDING
    assert _snapshot(db) == before
    assert _balance(db, beto) == 6_000
    assert _transfers(db) == 1


@pytest.mark.parametrize("action", ["reject", "cancel"])
def test_an_accepted_request_cannot_be_rejected_or_cancelled(
    client: TestClient, db: Engine, action: str
) -> None:
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 10_000)
    request_id = _pending(client, ana, beto)
    assert _accept(client, beto.token, request_id).status_code == 200
    before = _snapshot(db)
    actor = beto if action == "reject" else ana

    response = _resolve(client, actor.token, request_id, action)

    assert response.status_code == 409
    assert _row(db, request_id).status == "ACCEPTED"
    assert _snapshot(db) == before


# --- Idempotencia ---------------------------------------------------------------------------


def test_retry_after_a_lost_response_returns_the_original_result(
    client: TestClient, db: Engine
) -> None:
    """La solicitud ya está ACCEPTED, pero repetir con la MISMA clave no es un 409: devuelve la
    respuesta original, sin una segunda transferencia. Ni siquiera cambia el saldo informado,
    aunque el saldo real del pagador se haya movido después."""
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 10_000)
    request_id = _pending(client, ana, beto)
    original = _accept(client, beto.token, request_id, key="pago-cena")
    assert original.status_code == 200
    assert deposit_request(client, beto.token, 500).status_code == 201
    before = _snapshot(db)

    retries = [_accept(client, beto.token, request_id, key="pago-cena") for _ in range(3)]

    for retry in retries:
        assert retry.status_code == 200
        assert retry.headers["Idempotent-Replayed"] == "true"
        assert retry.json() == original.json()
    assert _snapshot(db) == before
    assert _balance(db, beto) == 6_500
    assert _balance(db, ana) == 4_000
    assert _transfers(db) == 1


def test_same_key_for_another_request_is_rejected(client: TestClient, db: Engine) -> None:
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 10_000)
    first = _pending(client, ana, beto, 1_000)
    second = _pending(client, ana, beto, 1_000)
    assert _accept(client, beto.token, first, key="k").status_code == 200
    before = _snapshot(db)

    response = _accept(client, beto.token, second, key="k")

    assert response.status_code == 422
    assert response.json() == KEY_REUSED
    _assert_untouched(db, second, before)


@pytest.mark.parametrize("operation", ["transfer", "deposit", "create"])
def test_key_used_by_another_operation_is_rejected(
    client: TestClient, db: Engine, operation: str
) -> None:
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 10_000)
    carla = _funded(client, "Carla", 0)
    request_id = _pending(client, ana, beto)
    previous = {
        "transfer": lambda: transfer_request(client, beto.token, carla.id, 100, key="usada"),
        "deposit": lambda: deposit_request(client, beto.token, 100, key="usada"),
        "create": lambda: money_request_create(client, beto.token, carla.id, 100, key="usada"),
    }[operation]()
    assert previous.status_code == 201
    before = _snapshot(db)

    response = _accept(client, beto.token, request_id, key="usada")

    assert response.status_code == 422
    assert response.json() == KEY_REUSED
    _assert_untouched(db, request_id, before)


def test_keys_are_scoped_per_account(client: TestClient, db: Engine) -> None:
    """La clave que usó el solicitante al crear no interfiere con la del pagador al aceptar."""
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 10_000)
    response = money_request_create(client, ana.token, beto.id, 4_000, key="misma")
    request_id = response.json()["id"]

    accepted = _accept(client, beto.token, request_id, key="misma")

    assert accepted.status_code == 200
    assert "Idempotent-Replayed" not in accepted.headers
    assert _balance(db, ana) == 4_000


# --- Atomicidad -----------------------------------------------------------------------------


def test_transfer_service_does_not_commit_on_its_own(client: TestClient, db: Engine) -> None:
    """Base de la atomicidad: transfer() solo escribe en la transacción del llamador. Si este
    hace rollback, no queda nada."""
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 10_000)
    before = _snapshot(db)

    with get_sessionmaker()() as session:
        ledger_service.transfer(session, uuid.UUID(beto.id), uuid.UUID(ana.id), 4_000, None)
        # Desde OTRA conexión todavía no se ve nada: no hubo commit.
        assert _snapshot(db) == before
        session.rollback()

    assert _snapshot(db) == before
    assert_ledger_is_consistent(db)


def _failing_client() -> TestClient:
    return TestClient(create_app(), raise_server_exceptions=False)


def test_failure_after_the_transfer_rolls_everything_back(
    client: TestClient, db: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """La transferencia ya escribió débito, crédito y asientos (flush) cuando algo falla
    antes de cambiar el estado: no debe quedar nada, y la clave sigue libre."""
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 10_000)
    request_id = _pending(client, ana, beto)
    before = _snapshot(db)
    real_transfer = ledger_service.transfer

    def transfer_then_fail(*args: Any, **kwargs: Any) -> Any:
        real_transfer(*args, **kwargs)
        raise RuntimeError("fallo simulado después de la transferencia")

    monkeypatch.setattr(ledger_service, "transfer", transfer_then_fail)
    with _failing_client() as failing:
        assert _accept(failing, beto.token, request_id, key="k").status_code == 500
    _assert_untouched(db, request_id, before)

    monkeypatch.undo()
    assert _accept(client, beto.token, request_id, key="k").status_code == 200
    assert _balance(db, ana) == 4_000
    assert_ledger_is_consistent(db)


def test_failure_saving_the_idempotency_record_rolls_everything_back(
    client: TestClient, db: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Transferencia y cambio de estado ya escritos (flush) cuando falla el último paso antes
    del commit: el registro de idempotencia. Todo se deshace junto."""
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 10_000)
    request_id = _pending(client, ana, beto)
    before = _snapshot(db)

    def failing_insert(*_args: object, **_kwargs: object) -> object:
        raise RuntimeError("fallo simulado al guardar el registro de idempotencia")

    monkeypatch.setattr(idempotency_service, "insert", failing_insert)
    with _failing_client() as failing:
        assert _accept(failing, beto.token, request_id).status_code == 500
    _assert_untouched(db, request_id, before)


def test_failure_marking_the_request_rolls_the_transfer_back(
    client: TestClient, db: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Un error de la propia BD al guardar el nuevo estado (aquí, violar el CHECK que exige
    transaction_id) también deshace la transferencia ya escrita."""
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 10_000)
    request_id = _pending(client, ana, beto)
    before = _snapshot(db)
    real_transfer = ledger_service.transfer

    class _NoId:
        id = None

    def transfer_without_id(*args: Any, **kwargs: Any) -> Any:
        real_transfer(*args, **kwargs)
        return _NoId()

    monkeypatch.setattr(ledger_service, "transfer", transfer_without_id)
    with _failing_client() as failing:
        assert _accept(failing, beto.token, request_id).status_code == 500
    _assert_untouched(db, request_id, before)


# --- Concurrencia ---------------------------------------------------------------------------


def _in_parallel(jobs: list[Any], work: Any) -> list[Any]:
    barrier = threading.Barrier(len(jobs))

    def run(job: Any) -> Any:
        barrier.wait()
        return work(job)

    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        return list(pool.map(run, jobs))


def test_concurrent_accepts_with_different_keys_pay_once(client: TestClient, db: Engine) -> None:
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 100_000)
    request_id = _pending(client, ana, beto, 4_000)

    responses = _in_parallel(list(range(10)), lambda _: _accept(client, beto.token, request_id))

    assert sorted(r.status_code for r in responses) == [200] + [409] * 9
    assert _balance(db, beto) == 96_000
    assert _balance(db, ana) == 4_000
    assert _transfers(db) == 1
    assert_ledger_is_consistent(db)


def test_concurrent_accepts_with_the_same_key_all_get_the_original_response(
    client: TestClient, db: Engine
) -> None:
    """Doble clic: todas reciben 200 con la misma respuesta; solo una no está marcada como
    repetida, y hay una única transferencia."""
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 100_000)
    request_id = _pending(client, ana, beto, 4_000)

    responses = _in_parallel(
        list(range(10)), lambda _: _accept(client, beto.token, request_id, key="doble-clic")
    )

    assert {r.status_code for r in responses} == {200}
    # Mismo contenido (JSONB puede reordenar las claves del texto, no los valores).
    bodies = [r.json() for r in responses]
    assert all(body == bodies[0] for body in bodies)
    replayed = [r.headers.get("Idempotent-Replayed") for r in responses]
    assert replayed.count("true") == 9
    assert replayed.count(None) == 1
    assert _balance(db, beto) == 96_000
    assert _transfers(db) == 1
    assert_ledger_is_consistent(db)


def test_same_key_on_two_requests_at_once_pays_only_one(client: TestClient, db: Engine) -> None:
    """Dos solicitudes distintas no comparten bloqueo; la clave única decide: una paga y la
    otra recibe 422 y se deshace entera."""
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 100_000)
    first = _pending(client, ana, beto, 1_000)
    second = _pending(client, ana, beto, 2_000)

    responses = _in_parallel(
        [first, second], lambda rid: _accept(client, beto.token, rid, key="compartida")
    )

    assert sorted(r.status_code for r in responses) == [200, 422]
    statuses = sorted(_row(db, rid).status for rid in (first, second))
    assert statuses == ["ACCEPTED", "PENDING"]
    paid = 1_000 if _row(db, first).status == "ACCEPTED" else 2_000
    assert _balance(db, ana) == paid
    assert _balance(db, beto) == 100_000 - paid
    assert _transfers(db) == 1
    assert_ledger_is_consistent(db)


def test_accept_reject_and_cancel_races_have_exactly_one_winner(
    client: TestClient, db: Engine
) -> None:
    """En cada solicitud compiten aceptar (pagador), rechazar (pagador) y cancelar
    (solicitante). Solo una gana, el estado final es el suyo y la plata se movió si y solo si
    ganó aceptar."""
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 1_000_000)
    amounts = [1_000 + i for i in range(12)]
    request_ids = [_pending(client, ana, beto, amount) for amount in amounts]
    jobs = [(rid, action) for rid in request_ids for action in ("accept", "reject", "cancel")]

    def work(job: tuple[str, str]) -> tuple[str, str, int]:
        rid, action = job
        token = ana.token if action == "cancel" else beto.token
        return rid, action, _resolve(client, token, rid, action).status_code

    results = _in_parallel(jobs, work)

    paid = 0
    for rid, amount in zip(request_ids, amounts, strict=True):
        outcomes = {action: status for r, action, status in results if r == rid}
        assert sorted(outcomes.values()) == [200, 409, 409], outcomes
        winner = next(action for action, status in outcomes.items() if status == 200)
        row = _row(db, rid)
        assert row.status == FINAL_STATUS[winner]
        assert (row.transaction_id is not None) == (winner == "accept")
        if winner == "accept":
            paid += amount
    assert _balance(db, ana) == paid
    assert _balance(db, beto) == 1_000_000 - paid
    assert _transfers(db) == sum(1 for _, a, s in results if a == "accept" and s == 200)
    assert_ledger_is_consistent(db)


def test_concurrent_accepts_cannot_overdraw_the_payer(client: TestClient, db: Engine) -> None:
    """Con 5.000 de saldo, de 10 solicitudes de 1.000 aceptadas a la vez solo pasan 5; las
    demás responden 409 y quedan PENDING."""
    ana = _funded(client, "Ana", 0)
    beto = _funded(client, "Beto", 5_000)
    request_ids = [_pending(client, ana, beto, 1_000) for _ in range(10)]

    responses = _in_parallel(request_ids, lambda rid: _accept(client, beto.token, rid))

    assert sorted(r.status_code for r in responses) == [200] * 5 + [409] * 5
    assert all(r.json() == INSUFFICIENT for r in responses if r.status_code == 409), (
        "los 409 deben ser por saldo, no por estado"
    )
    statuses = sorted(_row(db, rid).status for rid in request_ids)
    assert statuses == ["ACCEPTED"] * 5 + ["PENDING"] * 5
    assert _balance(db, beto) == 0
    assert _balance(db, ana) == 5_000
    assert_ledger_is_consistent(db)


def test_crossed_accepts_and_transfers_do_not_deadlock(client: TestClient, db: Engine) -> None:
    """Ana acepta solicitudes de Beto mientras Beto acepta las de Ana, mezcladas con
    transferencias en ambos sentidos. Mismo orden de bloqueo en todas (solicitud y luego
    cuentas por id): ningún interbloqueo, ningún error, y los saldos cuadran."""
    ana = _funded(client, "Ana", 100_000)
    beto = _funded(client, "Beto", 100_000)
    ana_pays = [_pending(client, beto, ana, 1_000) for _ in range(10)]
    beto_pays = [_pending(client, ana, beto, 2_000) for _ in range(10)]
    jobs: list[tuple[str, Any]] = (
        [("accept", (ana.token, rid)) for rid in ana_pays]
        + [("accept", (beto.token, rid)) for rid in beto_pays]
        + [("transfer", (ana.token, beto.id))] * 5
        + [("transfer", (beto.token, ana.id))] * 5
    )

    def work(job: tuple[str, Any]) -> int:
        kind, (token, target) = job
        if kind == "accept":
            return _accept(client, token, target).status_code
        return transfer_request(client, token, target, 500).status_code

    statuses = _in_parallel(jobs, work)

    assert statuses == [200] * 20 + [201] * 10
    # Ana: -10x1.000 pagados, +10x2.000 cobrados; las transferencias de 500 se compensan.
    assert _balance(db, ana) == 100_000 - 10_000 + 20_000
    assert _balance(db, beto) == 100_000 + 10_000 - 20_000
    assert _transfers(db) == 30
    assert_ledger_is_consistent(db)


def test_insufficient_funds_error_is_the_existing_one() -> None:
    """La aceptación reutiliza el error del ledger: mismo código y mensaje que transferir."""
    assert InsufficientFundsError.status_code == 409
    assert InsufficientFundsError.detail == INSUFFICIENT["detail"]
