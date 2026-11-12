"""Backend FastAPI para las pruebas E2E, conectado EXCLUSIVAMENTE a la base de pruebas.

Uso (desde la raíz del repositorio; lo lanza Playwright):

    uv run python frontend/e2e/backend.py serve   # migra habicapital_test y sirve en :8001
    uv run python frontend/e2e/backend.py check   # invariantes del ledger tras las pruebas

Antes de tocar nada comprueba que:
  1. la URL es HABICAPITAL_TEST_DATABASE_URL (variable distinta de la de desarrollo);
  2. la base se llama exactamente `habicapital_test` y no coincide con la de desarrollo;
  3. el servidor es local (localhost, 127.0.0.1 o ::1);
  4. una vez conectado, PostgreSQL confirma `current_database() = 'habicapital_test'`.
Si algo no cuadra, sale con error sin migrar ni arrancar. Nunca imprime la URL (contiene la
contraseña). No modifica el backend: solo lo arranca con otra configuración.
"""

from __future__ import annotations

import os
import sys

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine, make_url, text

EXPECTED_DATABASE = "habicapital_test"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
HOST = "127.0.0.1"
PORT = int(os.environ.get("HABICAPITAL_E2E_API_PORT", "8001"))


class _TestDatabase(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="HABICAPITAL_TEST_", env_file=".env", extra="ignore"
    )
    database_url: SecretStr | None = None


class _DevDatabase(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="HABICAPITAL_", env_file=".env", extra="ignore")
    database_url: SecretStr | None = None


def fail(message: str) -> None:
    print(f"[e2e-backend] ABORTADO: {message}", file=sys.stderr)
    sys.exit(2)


def test_database_url() -> str:
    configured = _TestDatabase().database_url
    if configured is None:
        fail("falta HABICAPITAL_TEST_DATABASE_URL (entorno o .env).")
        raise AssertionError  # pragma: no cover - fail() sale
    raw = configured.get_secret_value()
    url = make_url(raw)
    if url.database != EXPECTED_DATABASE:
        fail(f"la base de pruebas debe ser '{EXPECTED_DATABASE}' (configurada: {url.database!r}).")
    if (url.host or "localhost") not in LOCAL_HOSTS:
        fail("la base de pruebas debe estar en este equipo (localhost).")
    dev = _DevDatabase().database_url
    if dev is not None:
        dev_url = make_url(dev.get_secret_value())
        if (
            dev_url.database == url.database
            and dev_url.host == url.host
            and dev_url.port == url.port
        ):
            fail("la URL de pruebas apunta a la misma base que la de desarrollo.")
    engine = create_engine(raw, connect_args={"connect_timeout": 5})
    try:
        with engine.connect() as connection:
            name = connection.execute(text("SELECT current_database()")).scalar_one()
    finally:
        engine.dispose()
    if name != EXPECTED_DATABASE:
        fail(f"PostgreSQL informa la base {name!r}, no '{EXPECTED_DATABASE}'.")
    return raw


def serve() -> None:
    url = test_database_url()
    # Tiene prioridad sobre el .env: la app y Alembic leen HABICAPITAL_DATABASE_URL.
    os.environ["HABICAPITAL_DATABASE_URL"] = url

    from alembic import command
    from alembic.config import Config

    from habicapital.config import get_settings

    get_settings.cache_clear()
    if make_url(get_settings().database_url.get_secret_value()).database != EXPECTED_DATABASE:
        fail("la configuración de la app no quedó en la base de pruebas.")

    config = Config()
    config.set_main_option("script_location", os.path.join(os.getcwd(), "migrations"))
    command.upgrade(config, "head")
    print(
        f"[e2e-backend] base '{EXPECTED_DATABASE}' verificada y migrada; sirviendo en {HOST}:{PORT}"
    )

    import uvicorn

    uvicorn.run("habicapital.main:app", host=HOST, port=PORT, log_level="warning")


def check() -> None:
    """Mismas invariantes que tests/conftest.assert_ledger_is_consistent, sobre habicapital_test."""
    url = test_database_url()
    engine = create_engine(url)
    queries = {
        "la suma de todos los saldos (incluida FUNDING) debe ser 0": (
            "SELECT 1 WHERE (SELECT COALESCE(SUM(balance), 0) FROM accounts) <> 0"
        ),
        "cada transacción debe tener >= 2 asientos que suman 0": (
            "SELECT transaction_id FROM ledger_entries GROUP BY transaction_id "
            "HAVING SUM(amount) <> 0 OR COUNT(*) < 2"
        ),
        "cada saldo debe ser igual a la suma de sus asientos": (
            "SELECT a.id FROM accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id "
            "GROUP BY a.id, a.balance HAVING a.balance <> COALESCE(SUM(e.amount), 0)"
        ),
        "ninguna cuenta de usuario puede quedar en negativo": (
            "SELECT id FROM accounts WHERE kind = 'USER' AND balance < 0"
        ),
        "las solicitudes aceptadas tienen exactamente una transacción": (
            "SELECT id FROM money_requests "
            "WHERE (status = 'ACCEPTED') <> (transaction_id IS NOT NULL)"
        ),
    }
    problems = []
    try:
        with engine.connect() as connection:
            for description, query in queries.items():
                if connection.execute(text(query)).first() is not None:
                    problems.append(description)
    finally:
        engine.dispose()
    if problems:
        fail("ledger inconsistente: " + "; ".join(problems))
    print(f"[e2e-backend] ledger de '{EXPECTED_DATABASE}' consistente")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "serve":
        serve()
    elif mode == "check":
        check()
    else:
        fail("uso: backend.py serve|check")
