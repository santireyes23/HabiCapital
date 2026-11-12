"""Autenticación y diseño de rutas que se pueden verificar sin BD."""

import logging
import re

import pytest
from fastapi.testclient import TestClient

from habicapital.accounts import service
from habicapital.main import create_app

PROTECTED = [("GET", "/accounts/me"), ("POST", "/accounts/me/token")]


@pytest.mark.parametrize(("method", "path"), PROTECTED)
def test_missing_token_is_rejected(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path)

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
    assert response.json() == {"detail": "Token ausente o inválido"}


@pytest.mark.parametrize(("method", "path"), PROTECTED)
def test_non_bearer_scheme_is_rejected(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path, headers={"Authorization": "Basic YW5hOmFuYQ=="})

    assert response.status_code == 401


def test_account_routes_never_take_an_account_id_from_the_client(client: TestClient) -> None:
    """Guarda estructural contra IDOR: la cuenta propia se deduce del token, no de la URL."""
    paths = client.get("/openapi.json").json()["paths"]
    account_paths = [path for path in paths if path.startswith("/accounts")]

    assert account_paths
    assert not [path for path in account_paths if re.search(r"\{[^}]+\}", path)]


def test_protected_routes_declare_bearer_security(client: TestClient) -> None:
    paths = client.get("/openapi.json").json()["paths"]

    for method, path in PROTECTED:
        assert paths[path][method.lower()]["security"] == [{"HTTPBearer": []}]


def test_token_does_not_leak_when_account_creation_fails(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Si algo falla después de generar el token, no debe aparecer en la respuesta ni en
    los logs de error (traza incluida)."""
    secret = "TOKEN-SECRETO-DE-PRUEBA-0123456789abcdefghijklmn"

    def failing_hash(_token: str) -> str:
        raise RuntimeError("fallo simulado al calcular el hash")

    monkeypatch.setattr(service, "generate_token", lambda: secret)
    monkeypatch.setattr(service, "hash_token", failing_hash)
    caplog.set_level(logging.DEBUG)

    with TestClient(create_app(), raise_server_exceptions=False) as client:
        response = client.post("/accounts", json={"owner_name": "Ana"})

    assert response.status_code == 500
    assert secret not in response.text
    assert secret not in caplog.text
