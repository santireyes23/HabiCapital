"""Guardas estructurales de las rutas de solicitudes (no requieren PostgreSQL)."""

import re

import pytest
from fastapi.testclient import TestClient

MONEY_REQUEST_ROUTES = [
    ("POST", "/money-requests"),
    ("GET", "/money-requests"),
    ("GET", "/money-requests/{request_id}"),
    ("POST", "/money-requests/{request_id}/reject"),
    ("POST", "/money-requests/{request_id}/cancel"),
    ("POST", "/money-requests/{request_id}/accept"),
]


def _operations(client: TestClient) -> dict[tuple[str, str], dict[str, object]]:
    paths = client.get("/openapi.json").json()["paths"]
    return {
        (method.upper(), path): operation
        for path, methods in paths.items()
        if path.startswith("/money-requests")
        for method, operation in methods.items()
    }


def test_money_request_routes_are_the_expected_ones(client: TestClient) -> None:
    assert set(_operations(client)) == set(MONEY_REQUEST_ROUTES)


@pytest.mark.parametrize(("method", "path"), MONEY_REQUEST_ROUTES)
def test_money_request_routes_declare_bearer_security(
    client: TestClient, method: str, path: str
) -> None:
    assert _operations(client)[(method, path)]["security"] == [{"HTTPBearer": []}]


def test_the_only_path_parameter_is_the_request_id(client: TestClient) -> None:
    """Ninguna ruta recibe un id de cuenta en la URL: la cuenta propia sale del token."""
    for _method, path in _operations(client):
        assert set(re.findall(r"\{([^}]+)\}", path)) <= {"request_id"}


def test_create_body_has_no_requester_field(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()["components"]["schemas"]["MoneyRequestCreate"]

    assert set(schema["properties"]) == {"payer_account_id", "amount", "description"}
    assert schema["additionalProperties"] is False


@pytest.mark.parametrize("path", ["/money-requests", "/money-requests/{request_id}/accept"])
def test_money_moving_routes_require_an_idempotency_key(client: TestClient, path: str) -> None:
    operation = _operations(client)[("POST", path)]
    parameters = operation["parameters"]
    assert isinstance(parameters, list)

    key = next(p for p in parameters if p["name"] == "Idempotency-Key")
    assert key["in"] == "header"
    assert key["required"] is True


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/money-requests"),
        ("GET", "/money-requests?role=sent"),
        ("GET", "/money-requests/00000000-0000-0000-0000-0000000000aa"),
        ("POST", "/money-requests/00000000-0000-0000-0000-0000000000aa/reject"),
        ("POST", "/money-requests/00000000-0000-0000-0000-0000000000aa/cancel"),
        ("POST", "/money-requests/00000000-0000-0000-0000-0000000000aa/accept"),
    ],
)
def test_missing_token_is_rejected(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path)

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
    assert response.json() == {"detail": "Token ausente o inválido"}
