"""Pruebas unitarias del token (sin BD)."""

import re

from habicapital.accounts.security import TOKEN_HASH_LENGTH, generate_token, hash_token


def test_tokens_have_at_least_256_bits_and_are_url_safe() -> None:
    token = generate_token()

    # 32 bytes en base64url sin relleno = 43 caracteres.
    assert len(token) >= 43
    assert re.fullmatch(r"[A-Za-z0-9_-]+", token)


def test_tokens_do_not_repeat() -> None:
    tokens = {generate_token() for _ in range(1000)}

    assert len(tokens) == 1000


def test_hash_is_sha256_hex_deterministic_and_never_the_token() -> None:
    token = generate_token()
    digest = hash_token(token)

    assert len(digest) == TOKEN_HASH_LENGTH
    assert re.fullmatch(r"[0-9a-f]{64}", digest)
    assert digest == hash_token(token)
    assert digest != token
    assert token not in digest


def test_different_tokens_have_different_hashes() -> None:
    assert hash_token(generate_token()) != hash_token(generate_token())
