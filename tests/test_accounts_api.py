"""Creación de cuentas, autenticación y aislamiento entre cuentas (requiere PostgreSQL)."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from tests.conftest import bearer, create_account

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("db")]


def test_create_account_returns_token_once_and_forbids_caching(client: TestClient) -> None:
    response = client.post("/accounts", json={"owner_name": "  Ana Pérez  "})

    assert response.status_code == 201
    body = response.json()
    assert set(body) == {"id", "owner_name", "balance", "created_at", "token"}
    assert body["balance"] == 0
    assert body["owner_name"] == "Ana Pérez"
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize(
    "payload",
    [
        {"owner_name": ""},
        {"owner_name": "   "},
        {"owner_name": "x" * 101},
        {},
        {"owner_name": "Ana", "token": "elegido"},
    ],
)
def test_invalid_account_payloads_are_rejected(client: TestClient, payload: dict[str, str]) -> None:
    assert client.post("/accounts", json=payload).status_code == 422


def test_me_returns_the_authenticated_account_without_secrets(client: TestClient) -> None:
    ana = create_account(client, "Ana")

    response = client.get("/accounts/me", headers=bearer(ana.token))

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == ana.id
    assert body["owner_name"] == "Ana"
    assert "token" not in body
    assert "token_hash" not in body


def test_unknown_token_is_rejected(client: TestClient) -> None:
    create_account(client, "Ana")

    response = client.get("/accounts/me", headers=bearer("token-que-no-existe"))

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_each_token_only_reaches_its_own_account(client: TestClient) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")

    as_ana = client.get("/accounts/me", headers=bearer(ana.token)).json()
    as_beto = client.get("/accounts/me", headers=bearer(beto.token)).json()

    assert as_ana["id"] == ana.id
    assert as_beto["id"] == beto.id
    assert ana.token != beto.token


def test_an_account_id_does_not_work_as_a_credential(client: TestClient) -> None:
    ana = create_account(client, "Ana")

    assert client.get("/accounts/me", headers=bearer(ana.id)).status_code == 401


def test_rotating_one_account_does_not_touch_another(client: TestClient) -> None:
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")

    assert client.post("/accounts/me/token", headers=bearer(ana.token)).status_code == 200

    response = client.get("/accounts/me", headers=bearer(beto.token))
    assert response.status_code == 200
    assert response.json()["id"] == beto.id


def test_database_rejects_a_value_that_is_not_a_sha256_hash(db: Engine) -> None:
    """Última defensa: aunque un bug intentara guardar el token en claro, la BD lo rechaza."""
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError), db.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO accounts (id, owner_name, token_hash) "
                "VALUES (gen_random_uuid(), 'Ana', 'token-en-claro')"
            )
        )
