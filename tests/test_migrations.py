"""Las migraciones aplican, revierten y coinciden con los modelos (requiere PostgreSQL)."""

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import Engine, inspect

from habicapital.db import Base
from tests.conftest import alembic_config

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
