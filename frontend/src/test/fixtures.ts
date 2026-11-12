/** Constructores de datos SOLO PARA PRUEBAS, con la forma exacta de los schemas del backend. */

import type {
  Counterparty,
  MoneyRequestRead,
  MoneyRequestStatus,
  MovementRead,
  MovementType,
} from "../api/types";

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

export function movement(
  type: MovementType,
  amount: number,
  createdAt: string,
  options: { counterparty?: Counterparty; description?: string | null; balanceAfter?: number } = {},
): MovementRead {
  return {
    transaction_id: nextId("aaaaaaaa"),
    type,
    direction: type === "TRANSFER_SENT" ? "OUT" : "IN",
    amount,
    balance_after: options.balanceAfter ?? 0,
    description: options.description ?? null,
    counterparty: type === "DEPOSIT" ? null : (options.counterparty ?? null),
    created_at: createdAt,
  };
}

export function moneyRequest(
  requester: Counterparty,
  payer: Counterparty,
  amount: number,
  status: MoneyRequestStatus,
  createdAt: string,
  description: string | null = null,
): MoneyRequestRead {
  const resolved = status !== "PENDING";
  return {
    id: nextId("bbbbbbbb"),
    requester,
    payer,
    amount,
    description,
    status,
    transaction_id: status === "ACCEPTED" ? nextId("cccccccc") : null,
    created_at: createdAt,
    // Resuelta un minuto después de crearse.
    resolved_at: resolved ? new Date(Date.parse(createdAt) + 60_000).toISOString() : null,
  };
}
