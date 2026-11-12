"""La configuración no tiene credenciales por defecto ni las expone."""

import pytest
from pydantic import ValidationError

from habicapital.config import Settings


def test_database_url_is_required_with_no_insecure_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("HABICAPITAL_DATABASE_URL", raising=False)

    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_database_password_is_not_shown_when_printing_settings() -> None:
    settings = Settings(
        database_url="postgresql+psycopg://user:contraseña-ficticia@localhost/db_test",
        _env_file=None,
    )

    assert "contraseña-ficticia" not in repr(settings)
    assert "contraseña-ficticia" not in str(settings.model_dump())
