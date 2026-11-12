/**
 * Comprobación mínima de las respuestas de cuenta antes de confiar en ellas: si el servidor (o un
 * proxy) devuelve algo inesperado, no se guarda ningún token ni se muestra una cuenta a medias.
 */

import { isUuid } from "../api/endpoints";
import { ApiError, INVALID_RESPONSE_MESSAGE } from "../api/errors";
import type { AccountCreated, AccountRead } from "../api/types";
import { isPlausibleToken } from "./tokenStore";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAccountRead(value: unknown): value is AccountRead {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isUuid(value.id) &&
    typeof value.owner_name === "string" &&
    typeof value.balance === "number" &&
    Number.isSafeInteger(value.balance) &&
    typeof value.created_at === "string"
  );
}

export function isAccountCreated(value: unknown): value is AccountCreated {
  if (!isAccountRead(value)) return false;
  const token: unknown = (value as unknown as Record<string, unknown>).token;
  return typeof token === "string" && isPlausibleToken(token);
}

/** Solo los campos públicos de la cuenta: el token nunca se copia a otros objetos. */
export function publicAccount(account: AccountRead): AccountRead {
  return {
    id: account.id,
    owner_name: account.owner_name,
    balance: account.balance,
    created_at: account.created_at,
  };
}

export function invalidAccountResponse(status: number): ApiError {
  return new ApiError("invalid_response", INVALID_RESPONSE_MESSAGE, status);
}
