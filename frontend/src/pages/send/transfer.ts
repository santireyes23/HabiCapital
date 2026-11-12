/** Utilidades de la transferencia (POST /accounts/me/transfers) sin interfaz, para probarlas. */

import { isUuid } from "../../api/endpoints";
import { ApiError, INVALID_RESPONSE_MESSAGE } from "../../api/errors";
import { operationScope, type PendingOperation } from "../../api/idempotency";
import { DESCRIPTION_MAX_LENGTH, MAX_TRANSFER_COP, type TransferCreate, type TransferRead } from "../../api/types";

/** Montos sugeridos del frame 02: reemplazan el valor del campo (como en Recargar). */
export const SUGGESTED_AMOUNTS = [20_000, 50_000, 100_000] as const;

export function transferScope(accountId: string): string {
  return operationScope(accountId, "transfer");
}

/**
 * Cuerpo exacto de la petición (y huella de la Idempotency-Key). Sin descripción, el campo no se
 * envía; con ella, va sin espacios alrededor (como la guarda el backend).
 */
export function transferPayload(toAccountId: string, amount: number, description: string | null): TransferCreate {
  const payload: TransferCreate = { to_account_id: toAccountId.trim().toLowerCase(), amount };
  return description === null ? payload : { ...payload, description };
}

/** «Todo el saldo»: el saldo real, con el tope que acepta la API por transferencia. */
export function allBalanceAmount(balance: number): number {
  return Math.max(0, Math.min(balance, MAX_TRANSFER_COP));
}

export function validateRecipient(raw: string, ownAccountId: string): string | null {
  const value = raw.trim();
  if (value === "") return "Ingresa el UUID de la cuenta destino.";
  if (!isUuid(value)) return "El UUID debe tener 36 caracteres con el formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.";
  if (value.toLowerCase() === ownAccountId.toLowerCase()) return "No puedes transferirte a tu propia cuenta.";
  return null;
}

/** Descripción opcional: sin espacios alrededor y hasta 140 caracteres (contados como Python). */
export function normalizeDescription(raw: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const value = raw.trim();
  if (value === "") return { ok: true, value: null };
  if (Array.from(value).length > DESCRIPTION_MAX_LENGTH) {
    return { ok: false, error: `La descripción admite máximo ${DESCRIPTION_MAX_LENGTH} caracteres.` };
  }
  return { ok: true, value };
}

/** Los datos de una transferencia pendiente, leídos de su huella guardada. */
export function pendingTransfer(operation: PendingOperation): TransferCreate | null {
  try {
    const parsed: unknown = JSON.parse(operation.fingerprint);
    if (typeof parsed !== "object" || parsed === null) return null;
    const data = parsed as Record<string, unknown>;
    const { to_account_id: to, amount, description } = data;
    if (typeof to !== "string" || !isUuid(to)) return null;
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) return null;
    if (description !== undefined && typeof description !== "string") return null;
    return transferPayload(to, amount, description ?? null);
  } catch {
    return null;
  }
}

export function isTransferRead(value: unknown): value is TransferRead {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.transaction_id === "string" &&
    isUuid(data.transaction_id) &&
    typeof data.to_account_id === "string" &&
    isUuid(data.to_account_id) &&
    typeof data.amount === "number" &&
    Number.isSafeInteger(data.amount) &&
    typeof data.balance === "number" &&
    Number.isSafeInteger(data.balance) &&
    typeof data.created_at === "string" &&
    (data.description === null || typeof data.description === "string")
  );
}

export function invalidTransferResponse(status: number): ApiError {
  return new ApiError("invalid_response", INVALID_RESPONSE_MESSAGE, status);
}
