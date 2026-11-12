/**
 * Textos de una solicitud según su estado y según el papel de la cuenta autenticada:
 * - received: me la hicieron a mí (soy el pagador).
 * - sent: la hice yo (soy el solicitante).
 * Solo dicen lo que el backend garantiza: aceptar = transferencia del pagador al solicitante.
 */

import type { Counterparty, MoneyRequestRead, MoneyRequestRole } from "../../api/types";

export type AmountTone = "accent" | "negative" | "muted";

export interface RequestCopy {
  role: MoneyRequestRole;
  /** La otra parte de la solicitud. */
  counterparty: Counterparty;
  roleTag: string;
  amountLabel: string;
  amountSign: "" | "+" | "-";
  amountTone: AmountTone;
  footer: string;
  /** Fecha relevante: creación si sigue pendiente, resolución si ya terminó. */
  date: string;
}

export function roleOf(request: MoneyRequestRead, accountId: string): MoneyRequestRole {
  return request.payer.account_id === accountId ? "received" : "sent";
}

export function describeRequest(request: MoneyRequestRead, accountId: string): RequestCopy {
  const role = roleOf(request, accountId);
  const counterparty = role === "received" ? request.requester : request.payer;
  const roleTag = role === "received" ? "Te pide" : "Le pediste";
  const date = request.status === "PENDING" ? request.created_at : (request.resolved_at ?? request.created_at);
  const base = { role, counterparty, roleTag, date };

  switch (request.status) {
    case "PENDING":
      return {
        ...base,
        amountLabel: "Monto solicitado",
        amountSign: "",
        amountTone: "accent",
        footer:
          role === "received"
            ? "Pendiente de tu respuesta en Solicitudes"
            : `Esperando la respuesta de ${counterparty.owner_name}`,
      };
    case "ACCEPTED":
      return role === "received"
        ? {
            ...base,
            amountLabel: "Monto pagado",
            amountSign: "-",
            amountTone: "negative",
            footer: "Pagaste esta solicitud desde tu saldo",
          }
        : {
            ...base,
            amountLabel: "Monto acreditado",
            amountSign: "+",
            amountTone: "accent",
            footer: "Acreditado a tu saldo",
          };
    case "REJECTED":
      return {
        ...base,
        amountLabel: "Monto declinado",
        amountSign: "",
        amountTone: "negative",
        footer:
          role === "received"
            ? "Rechazaste esta solicitud"
            : `${counterparty.owner_name} rechazó tu solicitud`,
      };
    case "CANCELLED":
      return {
        ...base,
        amountLabel: "Monto anulado",
        amountSign: "",
        amountTone: "muted",
        footer:
          role === "received"
            ? `${counterparty.owner_name} la canceló antes de que respondieras`
            : "Cancelaste esta solicitud",
      };
  }
}

/** Mezcla enviadas y recibidas (pestaña «Todas»): más reciente primero, desempate por id. */
export function mergeRecent(
  received: readonly MoneyRequestRead[],
  sent: readonly MoneyRequestRead[],
  limit: number,
): MoneyRequestRead[] {
  return [...received, ...sent]
    .sort((a, b) => {
      const byDate = Date.parse(b.created_at) - Date.parse(a.created_at);
      return byDate !== 0 ? byDate : b.id.localeCompare(a.id);
    })
    .slice(0, limit);
}
