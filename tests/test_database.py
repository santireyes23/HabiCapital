import pytest
from sqlalchemy import Engine, text

pytestmark = pytest.mark.db

# Misma versión mayor en local, Docker Compose y CI.
POSTGRES_MAJOR = 18


def test_connects_to_the_expected_postgres_version(engine: Engine) -> None:
    with engine.connect() as connection:
        version = connection.execute(text("SHOW server_version_num")).scalar_one()

    assert int(version) // 10000 == POSTGRES_MAJOR


def test_uses_isolated_test_database(engine: Engine) -> None:
    with engine.connect() as connection:
        name = connection.execute(text("SELECT current_database()")).scalar_one()

    assert name == "habicapital_test"
