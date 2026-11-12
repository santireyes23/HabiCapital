from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class PytestDatabaseSettings(BaseSettings):
    """URL de la base de pruebas: HABICAPITAL_TEST_DATABASE_URL (entorno o .env).

    Es una variable distinta de la de desarrollo, así que la suite nunca hereda por error
    la base principal. El valor por defecto usa las credenciales ficticias de desarrollo.
    """

    model_config = SettingsConfigDict(
        env_prefix="HABICAPITAL_TEST_", env_file=".env", extra="ignore"
    )

    database_url: SecretStr = SecretStr(
        "postgresql+psycopg://habicapital:habicapital@localhost:5432/habicapital_test"
    )
