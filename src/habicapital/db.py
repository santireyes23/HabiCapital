from collections.abc import Iterator
from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from sqlalchemy import Engine, MetaData, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from habicapital.config import get_settings

# Nombres deterministas para constraints: migraciones Alembic estables y legibles.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


@lru_cache
def get_engine() -> Engine:
    settings = get_settings()
    return create_engine(
        settings.database_url.get_secret_value(),
        pool_pre_ping=True,
        # Los valores de las sentencias no aparecen en logs ni en mensajes de excepción.
        hide_parameters=True,
        connect_args={"connect_timeout": settings.database_connect_timeout},
    )


@lru_cache
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """Dependencia de FastAPI: una sesión por request.

    Cada caso de uso confirma su trabajo con `session.commit()`. Si algo falla antes,
    al cerrar la sesión se hace rollback de todo lo pendiente.
    """
    with get_sessionmaker()() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
