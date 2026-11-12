import uuid

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from habicapital.accounts.models import Account
from habicapital.accounts.security import generate_token, hash_token
from habicapital.errors import InvalidTokenError


def create_account(session: Session, owner_name: str) -> tuple[Account, str]:
    """Crea la cuenta y devuelve el token en claro, que el llamador entrega una sola vez."""
    token = generate_token()
    account = Account(owner_name=owner_name, token_hash=hash_token(token))
    session.add(account)
    session.commit()
    return account, token


def authenticate(session: Session, token: str) -> Account:
    account = session.scalars(
        select(Account).where(Account.token_hash == hash_token(token))
    ).one_or_none()
    if account is None:
        raise InvalidTokenError
    return account


def rotate_token(session: Session, account_id: uuid.UUID, current_token_hash: str) -> str:
    """Reemplaza el token vigente por uno nuevo y devuelve el nuevo en claro.

    El UPDATE es un compare-and-swap: solo afecta la fila si su hash sigue siendo el del
    token con el que se autenticó esta petición. Si dos regeneraciones con el mismo token
    corren a la vez, PostgreSQL bloquea la fila para la segunda hasta que la primera
    confirma y entonces vuelve a evaluar el WHERE: el hash ya cambió, no se actualiza
    ninguna fila y la segunda falla. Así nunca hay dos tokens nuevos emitidos para el mismo
    token anterior, y el anterior deja de servir en cuanto la primera confirma.
    """
    new_token = generate_token()
    updated_id = session.execute(
        update(Account)
        .where(Account.id == account_id, Account.token_hash == current_token_hash)
        .values(token_hash=hash_token(new_token), token_rotated_at=func.now())
        .returning(Account.id)
    ).scalar_one_or_none()
    if updated_id is None:
        session.rollback()
        raise InvalidTokenError
    session.commit()
    return new_token
