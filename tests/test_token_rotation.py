"""Regeneración del token: invalidación inmediata y concurrencia (requiere PostgreSQL)."""

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from habicapital.accounts import service
from habicapital.accounts.models import Account
from habicapital.accounts.security import hash_token
from habicapital.db import get_sessionmaker
from habicapital.errors import InvalidTokenError
from tests.conftest import bearer, create_account

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("db")]


def test_old_token_stops_working_immediately_and_new_one_works(client: TestClient) -> None:
    ana = create_account(client, "Ana")

    response = client.post("/accounts/me/token", headers=bearer(ana.token))

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    new_token = response.json()["token"]
    assert new_token != ana.token
    # Justo después, sin esperas: el anterior ya no sirve para nada.
    assert client.get("/accounts/me", headers=bearer(ana.token)).status_code == 401
    assert client.post("/accounts/me/token", headers=bearer(ana.token)).status_code == 401
    me = client.get("/accounts/me", headers=bearer(new_token))
    assert me.status_code == 200
    assert me.json()["id"] == ana.id


def test_rotating_twice_with_the_same_old_token_fails_the_second_time(client: TestClient) -> None:
    ana = create_account(client, "Ana")

    first = client.post("/accounts/me/token", headers=bearer(ana.token))
    second = client.post("/accounts/me/token", headers=bearer(ana.token))

    assert first.status_code == 200
    assert second.status_code == 401
    assert client.get("/accounts/me", headers=bearer(first.json()["token"])).status_code == 200


def _stored_hash(account_id: uuid.UUID) -> str | None:
    with get_sessionmaker()() as session:
        return session.scalars(select(Account.token_hash).where(Account.id == account_id)).one()


def test_rotation_records_when_it_happened(client: TestClient) -> None:
    ana = create_account(client, "Ana")

    def rotated_at() -> object:
        with get_sessionmaker()() as session:
            return session.scalars(
                select(Account.token_rotated_at).where(Account.id == uuid.UUID(ana.id))
            ).one()

    assert rotated_at() is None
    client.post("/accounts/me/token", headers=bearer(ana.token))
    assert rotated_at() is not None


def test_two_simultaneous_rotations_with_the_same_token_only_one_succeeds(
    client: TestClient,
) -> None:
    """Forzamos el peor caso: las dos peticiones ya se autenticaron con el token viejo
    (ambas lo vieron válido) antes de que cualquiera intente reemplazarlo."""
    ana = create_account(client, "Ana")
    both_authenticated = threading.Barrier(2, timeout=10)

    def rotate() -> str | None:
        with get_sessionmaker()() as session:
            account = service.authenticate(session, ana.token)
            assert account.token_hash is not None
            both_authenticated.wait()
            try:
                return service.rotate_token(session, account.id, account.token_hash)
            except InvalidTokenError:
                return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: rotate(), range(2)))

    winners = [token for token in results if token is not None]
    assert len(winners) == 1
    assert results.count(None) == 1
    assert _stored_hash(uuid.UUID(ana.id)) == hash_token(winners[0])


def test_many_concurrent_rotation_requests_issue_exactly_one_new_token(
    client: TestClient,
) -> None:
    ana = create_account(client, "Ana")

    def rotate(_: int) -> tuple[int, str | None]:
        response = client.post("/accounts/me/token", headers=bearer(ana.token))
        token = response.json().get("token") if response.status_code == 200 else None
        return response.status_code, token

    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(rotate, range(10)))

    statuses = sorted(status for status, _ in results)
    assert statuses == [200] + [401] * 9
    (winner,) = [token for _, token in results if token is not None]
    assert client.get("/accounts/me", headers=bearer(winner)).status_code == 200
    assert client.get("/accounts/me", headers=bearer(ana.token)).status_code == 401
