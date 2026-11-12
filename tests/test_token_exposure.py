"""El token en claro no aparece en tablas, logs ni respuestas posteriores (requiere PostgreSQL)."""

import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, inspect, text

from habicapital.accounts.security import hash_token
from tests.conftest import bearer, create_account

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("db")]


def _issue_tokens(client: TestClient) -> list[str]:
    """Recorre todo el ciclo de vida: crear, usar, regenerar, usar el viejo (falla)."""
    ana = create_account(client, "Ana")
    client.get("/accounts/me", headers=bearer(ana.token))
    rotated = client.post("/accounts/me/token", headers=bearer(ana.token)).json()["token"]
    client.get("/accounts/me", headers=bearer(ana.token))  # 401
    client.get("/accounts/me", headers=bearer(rotated))
    return [ana.token, rotated]


def _dump_every_table(engine: Engine) -> str:
    """Todas las filas de todas las tablas del esquema, incluidas las que se agreguen en
    etapas futuras (p. ej. registros de idempotencia): esta prueba las cubre sin cambios."""
    chunks: list[str] = []
    with engine.connect() as connection:
        for table in inspect(connection).get_table_names():
            rows = connection.execute(text(f'SELECT * FROM "{table}"')).all()
            chunks.extend(repr(tuple(row)) for row in rows)
    return "\n".join(chunks)


def test_plain_tokens_are_never_stored_only_their_hashes(client: TestClient, db: Engine) -> None:
    tokens = _issue_tokens(client)

    dump = _dump_every_table(db)

    for token in tokens:
        assert token not in dump
    # Control: el volcado sí contiene datos (el hash vigente), así que la búsqueda es real.
    assert hash_token(tokens[-1]) in dump


def test_plain_tokens_never_reach_the_logs_even_at_debug_level(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    """Con todo el logging al máximo (incluidas las filas que SQLAlchemy registra en DEBUG),
    el token en claro no aparece en ningún lugar."""
    caplog.set_level(logging.DEBUG)
    caplog.set_level(logging.DEBUG, logger="sqlalchemy.engine")

    tokens = _issue_tokens(client)

    assert "Row (" in caplog.text  # control: se capturaron también las filas de resultado
    for token in tokens:
        assert token not in caplog.text


def test_sql_logging_hides_statement_parameters(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    """Con el log de sentencias SQL activo (INFO), `hide_parameters=True` impide que los
    valores enviados a la BD, como el hash del token, queden registrados.

    En DEBUG SQLAlchemy registra además las filas devueltas, lo que sí incluiría el hash.
    Ese nivel no se usa fuera de depuración local, y un hash no sirve para autenticarse."""
    caplog.set_level(logging.INFO, logger="sqlalchemy.engine")

    tokens = _issue_tokens(client)

    assert "SELECT" in caplog.text  # control: el log de SQL realmente se capturó
    assert "parameters hidden" in caplog.text
    for token in tokens:
        assert token not in caplog.text
        assert hash_token(token) not in caplog.text


def test_token_only_appears_in_the_response_that_issues_it(client: TestClient) -> None:
    ana = create_account(client, "Ana")

    me = client.get("/accounts/me", headers=bearer(ana.token))
    rotation = client.post("/accounts/me/token", headers=bearer(ana.token))
    new_token = rotation.json()["token"]
    me_again = client.get("/accounts/me", headers=bearer(new_token))

    assert ana.token not in me.text
    assert ana.token not in rotation.text
    assert new_token not in me_again.text
