from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

import habicapital.models  # noqa: F401  (registra todas las tablas en Base.metadata)
from habicapital.config import get_settings
from habicapital.db import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Cada módulo de dominio con tablas debe importarse en habicapital/models.py.
target_metadata = Base.metadata

DATABASE_URL = get_settings().database_url.get_secret_value()


def run_migrations_offline() -> None:
    """Genera el SQL de las migraciones sin conectarse a la BD (`alembic upgrade --sql`)."""
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Aplica las migraciones contra la BD configurada."""
    connectable = create_engine(DATABASE_URL, poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
