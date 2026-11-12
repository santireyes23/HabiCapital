"""Las migraciones aplican, revierten y coinciden con los modelos (requiere PostgreSQL)."""

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from fastapi.testclient import TestClient
from sqlalchemy import Engine, inspect, text
from sqlalchemy.exc import IntegrityError

from habicapital.db import Base
from tests.conftest import alembic_config, create_account, deposit_request, transfer_request

pytestmark = pytest.mark.db


def test_upgrade_downgrade_upgrade_roundtrip(migrated_engine: Engine) -> None:
    config = alembic_config()

    command.downgrade(config, "base")
    assert "accounts" not in inspect(migrated_engine).get_table_names()

    command.upgrade(config, "head")
    assert "accounts" in inspect(migrated_engine).get_table_names()


def test_migrations_match_the_orm_models(migrated_engine: Engine) -> None:
    """Como la migración se escribió a mano, esto detecta cualquier diferencia con los modelos."""
    with migrated_engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"compare_type": True})
        differences = compare_metadata(context, Base.metadata)

    assert differences == []


TRANSFERS_REVISION = "16c8fda76905"
BEFORE_TRANSFERS = "e7379a43f6d1"


@pytest.mark.usefixtures("db")
def test_transfer_migration_downgrade_refuses_to_lose_transfers(client: TestClient) -> None:
    """Revertir la migración de transferencias con transferencias registradas descuadraría el
    ledger: el downgrade debe negarse y dejar el esquema intacto."""
    ana = create_account(client, "Ana")
    beto = create_account(client, "Beto")
    deposit_request(client, ana.token, 1_000)
    assert transfer_request(client, ana.token, beto.id, 500).status_code == 201

    with pytest.raises(RuntimeError, match="transferencias registradas"):
        command.downgrade(alembic_config(), BEFORE_TRANSFERS)

    command.upgrade(alembic_config(), "head")  # no-op: sigue en head
    assert transfer_request(client, ana.token, beto.id, 500).status_code == 201


@pytest.mark.usefixtures("db")
def test_transfer_migration_downgrade_restores_the_previous_constraint(db: Engine) -> None:
    config = alembic_config()
    command.downgrade(config, BEFORE_TRANSFERS)
    try:
        with pytest.raises(IntegrityError), db.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO ledger_transactions (id, kind) "
                    "VALUES (gen_random_uuid(), 'TRANSFER')"
                )
            )
    finally:
        command.upgrade(config, "head")
