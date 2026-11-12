/** Utilidades de la recarga (POST /accounts/me/deposits) sin interfaz, para poder probarlas. */

import { isUuid } from "../../api/endpoints";
import { ApiError, INVALID_RESPONSE_MESSAGE } from "../../api/errors";
import { operationScope, type PendingOperation } from "../../api/idempotency";
import type { DepositRead } from "../../api/types";

/** Montos rápidos del frame 03 (sin «+»: reemplazan el valor del campo, no suman). */
export const QUICK_AMOUNTS = [50_000, 100_000, 250_000, 500_000] as const;

export function depositScope(accountId: string): string {
  return operationScope(accountId, "deposit");
}

/** Datos que identifican una recarga para la Idempotency-Key (los mismos que viajan en el body). */
export function depositPayload(amount: number): { amount: number } {
  return { amount };
}

/** El monto de una recarga pendiente, leído de su huella guardada. null si no se puede leer. */
export function pendingAmount(operation: PendingOperation): number | null {
  try {
    const parsed: unknown = JSON.parse(operation.fingerprint);
    if (typeof parsed !== "object" || parsed === null) return null;
    const amount = (parsed as Record<string, unknown>).amount;
    return typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0 ? amount : null;
  } catch {
    return null;
  }
}

/** Comprueba la forma real de DepositRead antes de mostrar un éxito. */
export function isDepositRead(value: unknown): value is DepositRead {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.transaction_id === "string" &&
    isUuid(data.transaction_id) &&
    typeof data.amount === "number" &&
    Number.isSafeInteger(data.amount) &&
    typeof data.balance === "number" &&
    Number.isSafeInteger(data.balance) &&
    typeof data.created_at === "string" &&
    (data.description === null || typeof data.description === "string")
  );
}

/**
 * Una respuesta 2xx con forma inesperada: no se sabe qué pasó en el servidor, así que se trata
 * como resultado incierto (la operación queda pendiente con su misma clave).
 */
export function invalidDepositResponse(status: number): ApiError {
  return new ApiError("invalid_response", INVALID_RESPONSE_MESSAGE, status);
}
