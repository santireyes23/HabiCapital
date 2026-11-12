"""Errores de dominio y su traducción a HTTP en un único lugar."""

from typing import ClassVar

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class DomainError(Exception):
    """Base de los errores de negocio. Los mensajes nunca deben incluir secretos."""

    status_code: ClassVar[int] = 400
    detail: ClassVar[str] = "Solicitud inválida"
    headers: ClassVar[dict[str, str] | None] = None


class InvalidTokenError(DomainError):
    """Token ausente, desconocido o ya reemplazado por una regeneración."""

    status_code: ClassVar[int] = 401
    detail: ClassVar[str] = "Token ausente o inválido"
    headers: ClassVar[dict[str, str] | None] = {"WWW-Authenticate": "Bearer"}


class AccountNotFoundError(DomainError):
    status_code: ClassVar[int] = 404
    detail: ClassVar[str] = "Cuenta no encontrada"


class InsufficientFundsError(DomainError):
    status_code: ClassVar[int] = 409
    detail: ClassVar[str] = "Saldo insuficiente"


class IdempotencyKeyReusedError(DomainError):
    status_code: ClassVar[int] = 422
    detail: ClassVar[str] = "La Idempotency-Key ya se usó con una solicitud distinta"


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    def handle_domain_error(_request: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=exc.headers,
        )
