from fastapi import FastAPI

from habicapital.accounts.router import router as accounts_router
from habicapital.config import get_settings
from habicapital.errors import register_error_handlers
from habicapital.ledger.router import router as ledger_router
from habicapital.money_requests.router import router as money_requests_router


def create_app() -> FastAPI:
    get_settings()  # falla al arrancar si falta configuración obligatoria
    app = FastAPI(
        title="HabiCapital Wallet API",
        version="0.1.0",
        description=(
            "Billetera P2P: cuentas, cargas, transferencias, historial y cuentas divididas."
        ),
    )
    register_error_handlers(app)
    app.include_router(accounts_router)
    app.include_router(ledger_router)
    app.include_router(money_requests_router)

    @app.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
