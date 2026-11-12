"""Ejecución idempotente de operaciones que mueven dinero.

Garantía: para una misma (cuenta, Idempotency-Key) la operación se aplica como máximo una vez.

Cómo:
1. Si ya hay un registro para la clave, se devuelve la respuesta guardada sin ejecutar nada
   (o 422 si la clave se usó con otra solicitud).
2. Si no, se ejecuta la operación y, en la MISMA transacción, se inserta el registro con
   `INSERT ... ON CONFLICT DO NOTHING`. Si otra petición con la misma clave ganó la carrera,
   PostgreSQL hace esperar a esta en el índice único hasta que la otra confirma; entonces no
   se inserta nada, se descarta toda la operación (rollback) y se devuelve la respuesta de la
   ganadora. Nunca quedan dos movimientos para la misma clave.

Solo se guardan respuestas exitosas. Un rechazo de negocio (p. ej. saldo insuficiente) no
consume la clave: un reintento vuelve a evaluarse.
"""

import hashlib
import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from habicapital.errors import IdempotencyKeyReusedError
from habicapital.idempotency.models import IdempotencyRecord


@dataclass(frozen=True)
class IdempotentResult:
    status_code: int
    body: dict[str, Any]
    replayed: bool


def request_fingerprint(operation: str, payload: BaseModel) -> str:
    canonical = json.dumps(
        {"operation": operation, "payload": payload.model_dump(mode="json")},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _stored(session: Session, account_id: uuid.UUID, key: str) -> IdempotencyRecord | None:
    return session.scalars(
        select(IdempotencyRecord).where(
            IdempotencyRecord.account_id == account_id, IdempotencyRecord.key == key
        )
    ).one_or_none()


def _replay(record: IdempotencyRecord, request_hash: str) -> IdempotentResult:
    if record.request_hash != request_hash:
        raise IdempotencyKeyReusedError
    return IdempotentResult(record.status_code, record.response_body, replayed=True)


def run_idempotent(
    session: Session,
    *,
    account_id: uuid.UUID,
    key: str,
    request_hash: str,
    status_code: int,
    operation: Callable[[], BaseModel],
) -> IdempotentResult:
    existing = _stored(session, account_id, key)
    if existing is not None:
        return _replay(existing, request_hash)

    body = operation().model_dump(mode="json")
    inserted = session.execute(
        insert(IdempotencyRecord)
        .values(
            id=uuid.uuid4(),
            account_id=account_id,
            key=key,
            request_hash=request_hash,
            status_code=status_code,
            response_body=body,
        )
        .on_conflict_do_nothing(constraint="uq_idempotency_records_account_id_key")
        .returning(IdempotencyRecord.id)
    ).scalar_one_or_none()

    if inserted is None:
        # Otra petición con la misma clave confirmó primero: se descarta esta operación entera.
        session.rollback()
        winner = _stored(session, account_id, key)
        if winner is None:  # pragma: no cover - el conflicto implica que el registro existe
            raise RuntimeError("conflicto de idempotencia sin registro")
        return _replay(winner, request_hash)

    session.commit()
    return IdempotentResult(status_code, body, replayed=False)
