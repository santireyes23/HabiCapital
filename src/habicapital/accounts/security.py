"""Generación y hash de tokens de acceso.

El token en claro solo existe en memoria durante la petición que lo emite y en la respuesta
que lo entrega al cliente. Nunca se guarda, se registra ni se incluye en mensajes de error.
"""

import hashlib
import secrets

TOKEN_BYTES = 32  # 256 bits de entropía
TOKEN_HASH_LENGTH = 64  # SHA-256 en hexadecimal


def generate_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> str:
    """SHA-256 sin sal: suficiente porque el token es aleatorio y de alta entropía.

    No reutilizar para secretos elegidos por personas (contraseñas): esos necesitan
    un hash lento con sal, como argon2 o bcrypt.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
