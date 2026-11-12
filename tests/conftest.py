import os
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from functools import cache
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import Engine, text
from sqlalchemy.exc import OperationalError

from tests.db_settings import PytestDatabaseSettings

# Se impone antes de que la app lea su configuración, y tiene prioridad sobre cualquier
# HABICAPITAL_DATABASE_URL del entorno o del .env (que apuntan a la base de desarrollo).
os.environ["HABICAPITAL_DATABASE_URL"] = PytestDatabaseSettings().database_url.get_secret_value()

from alembic import command
from alembic.config import Config
from sqlalchemy import make_url

import habicapital.models  # noqa: F401  (registra todas las tablas)
from habicapital.accounts.models import FUNDING_ACCOUNT_ID, FUNDING_ACCOUNT_NAME
from habicapital.config import get_settings
from habicapital.db import Base, get_engine
from habicapital.main import create_app

ROOT = Path(__file__).resolve().parents[1]

# En CI la BD es obligatoria: si no responde, las pruebas fallan en lugar de saltarse.
REQUIRE_DB = os.environ.get("HABICAPITAL_REQUIRE_DB") == "1"


def _assert_test_database() -> None:
    """Las pruebas vacían tablas con TRUNCATE: nunca deben tocar una base que no sea de pruebas."""
    url = make_url(get_settings().database_url.get_secret_value())
    if not (url.database or "").endswith("_test"):
        pytest.exit(
            f"Abortado: la BD de pruebas debe terminar en '_test' (configurada: {url.database!r}).",
            returncode=2,
        )


@cache
def _database_error() -> str | None:
    """Comprueba la conexión una sola vez por sesión de pruebas."""
    _assert_test_database()
    try:
        with get_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
    except OperationalError as exc:
        if REQUIRE_DB:
            # `from None` corta la traza del driver, cuyos argumentos incluyen la contraseña.
            raise RuntimeError(f"PostgreSQL no disponible: {exc.orig}") from None
        return exc.__class__.__name__
    return None


def alembic_config() -> Config:
    # Sin archivo .ini: así env.py no llama a fileConfig, que desactivaría los loggers
    # existentes y rompería las pruebas que inspeccionan logs.
    config = Config()
    config.set_main_option("script_location", str(ROOT / "migrations"))
    return config


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def engine() -> Engine:
    error = _database_error()
    if error is not None:
        pytest.skip(f"PostgreSQL no disponible ({error}); ejecuta `docker compose up -d db`")
    return get_engine()


@pytest.fixture(scope="session")
def migrated_engine(engine: Engine) -> Engine:
    command.upgrade(alembic_config(), "head")
    return engine


def _truncate_all(engine: Engine) -> None:
    """Vacía todas las tablas y vuelve a crear la cuenta FUNDING que crea la migración."""
    _assert_test_database()
    tables = ", ".join(table.name for table in Base.metadata.sorted_tables)
    with engine.begin() as connection:
        connection.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
        connection.execute(
            text(
                "INSERT INTO accounts (id, kind, owner_name, token_hash, balance) "
                "VALUES (:id, 'SYSTEM', :name, NULL, 0)"
            ),
            {"id": FUNDING_ACCOUNT_ID, "name": FUNDING_ACCOUNT_NAME},
        )


@pytest.fixture
def db(migrated_engine: Engine) -> Iterator[Engine]:
    """BD migrada y vacía. Se trunca (no rollback) porque las pruebas de concurrencia
    necesitan datos confirmados visibles desde varias conexiones."""
    _truncate_all(migrated_engine)
    yield migrated_engine
    _truncate_all(migrated_engine)


@dataclass(frozen=True)
class CreatedAccount:
    id: str
    owner_name: str
    token: str


def create_account(client: TestClient, owner_name: str = "Ana") -> CreatedAccount:
    response = client.post("/accounts", json={"owner_name": owner_name})
    assert response.status_code == 201, response.text
    body = response.json()
    return CreatedAccount(id=body["id"], owner_name=body["owner_name"], token=body["token"])


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def deposit_request(
    client: TestClient,
    token: str,
    amount: object,
    key: str | None = None,
    description: str | None = None,
) -> Response:
    body: dict[str, object] = {"amount": amount}
    if description is not None:
        body["description"] = description
    headers = bearer(token) | {"Idempotency-Key": key or str(uuid.uuid4())}
    response: Response = client.post("/accounts/me/deposits", json=body, headers=headers)
    return response


def assert_ledger_is_consistent(engine: Engine) -> None:
    """Invariantes de "no se pierde ni se crea un peso", verificadas directamente en la BD."""
    with engine.connect() as connection:
        total = connection.execute(text("SELECT COALESCE(SUM(balance), 0) FROM accounts")).scalar()
        unbalanced = connection.execute(
            text(
                "SELECT transaction_id FROM ledger_entries GROUP BY transaction_id "
                "HAVING SUM(amount) <> 0 OR COUNT(*) < 2"
            )
        ).all()
        mismatched = connection.execute(
            text(
                "SELECT a.id FROM accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id "
                "GROUP BY a.id, a.balance HAVING a.balance <> COALESCE(SUM(e.amount), 0)"
            )
        ).all()
        negative_users = connection.execute(
            text("SELECT id FROM accounts WHERE kind = 'USER' AND balance < 0")
        ).all()
        last_balance_mismatch = connection.execute(
            text(
                "SELECT a.id FROM accounts a JOIN LATERAL ("
                "  SELECT balance_after FROM ledger_entries e WHERE e.account_id = a.id"
                "  ORDER BY e.id DESC LIMIT 1) last ON true "
                "WHERE last.balance_after <> a.balance"
            )
        ).all()

    assert total == 0, "la suma de todos los saldos (incluida FUNDING) debe ser 0"
    assert unbalanced == [], "cada transacción debe tener >= 2 asientos que suman 0"
    assert mismatched == [], "cada saldo debe ser igual a la suma de sus asientos"
    assert negative_users == [], "ninguna cuenta de usuario puede quedar en negativo"
    assert last_balance_mismatch == [], "balance_after del último asiento debe ser el saldo"
