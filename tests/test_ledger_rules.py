"""Reglas de doble partida que se validan antes de tocar la BD (sin BD)."""

import uuid

import pytest

from habicapital.ledger.service import Leg, _validate_legs

A, B, C = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


def test_balanced_legs_are_accepted() -> None:
    _validate_legs([Leg(A, -100), Leg(B, 100)])
    _validate_legs([Leg(A, -100), Leg(B, 60), Leg(C, 40)])


@pytest.mark.parametrize(
    ("legs", "reason"),
    [
        ([Leg(A, 100)], "al menos dos"),
        ([Leg(A, -100), Leg(B, 99)], "sumar 0"),
        ([Leg(A, 0), Leg(B, 0)], "distinto de 0"),
        ([Leg(A, -100), Leg(A, 100)], "dos veces"),
        ([Leg(A, -1.5), Leg(B, 1.5)], "entero"),  # type: ignore[arg-type]
        ([Leg(A, True), Leg(B, -1)], "entero"),
    ],
)
def test_invalid_legs_are_rejected(legs: list[Leg], reason: str) -> None:
    with pytest.raises(ValueError, match=reason):
        _validate_legs(legs)
