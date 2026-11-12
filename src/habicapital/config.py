from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración leída de variables de entorno con prefijo HABICAPITAL_ (o de .env)."""

    model_config = SettingsConfigDict(
        env_prefix="HABICAPITAL_",
        env_file=".env",
        extra="ignore",
    )

    # Obligatoria y sin valor por defecto: si falta, la app no arranca en lugar de intentar
    # credenciales conocidas. SecretStr evita que la contraseña aparezca al imprimir la config.
    database_url: SecretStr
    # Segundos máximos para abrir una conexión; evita esperas largas si la BD no está arriba.
    database_connect_timeout: int = 5


@lru_cache
def get_settings() -> Settings:
    return Settings()
