"""money requests: final states are immutable

Revision ID: f97180fdd6af
Revises: 688a53fdf426
Create Date: 2026-11-12 09:19:52

Los CHECK de money_requests validan cada fila por separado, pero no pueden comparar la fila
nueva con la anterior. Este trigger sí: hace que la propia BD rechace cualquier transición
inválida aunque un bug del servicio se saltara la verificación de estado.

Reglas (BEFORE UPDATE OR DELETE, por fila):
- Una solicitud ACCEPTED, REJECTED o CANCELLED no se puede modificar de ninguna forma, ni
  borrar: no vuelve a PENDING, no cambia de estado final y una aceptada no pierde ni cambia su
  transferencia (transaction_id).
- Mientras está PENDING, sus datos (partes, monto, descripción, fecha de creación) tampoco
  cambian: lo único que puede pasar es que se resuelva.

TRUNCATE no dispara triggers por fila, así que la limpieza de las pruebas no se ve afectada.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "f97180fdd6af"
down_revision: str | Sequence[str] | None = "688a53fdf426"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FUNCTION = "money_requests_guard_final_states"
TRIGGER = "trg_money_requests_guard_final_states"


def upgrade() -> None:
    # SQLSTATE 23000 (integrity_constraint_violation): el driver lo informa como IntegrityError,
    # igual que un CHECK o una clave única.
    op.execute(
        f"""
        CREATE FUNCTION {FUNCTION}() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF OLD.status <> 'PENDING' THEN
                RAISE EXCEPTION '{FUNCTION}: la solicitud % ya está % y no se puede modificar',
                    OLD.id, OLD.status
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            IF TG_OP = 'UPDATE' AND (
                NEW.id IS DISTINCT FROM OLD.id
                OR NEW.requester_account_id IS DISTINCT FROM OLD.requester_account_id
                OR NEW.payer_account_id IS DISTINCT FROM OLD.payer_account_id
                OR NEW.amount IS DISTINCT FROM OLD.amount
                OR NEW.description IS DISTINCT FROM OLD.description
                OR NEW.created_at IS DISTINCT FROM OLD.created_at
            ) THEN
                RAISE EXCEPTION '{FUNCTION}: los datos de la solicitud % no se pueden modificar',
                    OLD.id
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            IF TG_OP = 'DELETE' THEN
                RETURN OLD;
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER {TRIGGER}
        BEFORE UPDATE OR DELETE ON money_requests
        FOR EACH ROW EXECUTE FUNCTION {FUNCTION}()
        """
    )


def downgrade() -> None:
    # Seguro: solo quita la protección. No cambia ni borra datos, saldos ni asientos.
    op.execute(f"DROP TRIGGER {TRIGGER} ON money_requests")
    op.execute(f"DROP FUNCTION {FUNCTION}()")
