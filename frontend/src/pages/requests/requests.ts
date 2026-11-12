/** Utilidades de Solicitudes de dinero sin interfaz (URL, validación, cuerpos y respuestas). */

import { isUuid } from "../../api/endpoints";
import { ApiError, INVALID_RESPONSE_MESSAGE } from "../../api/errors";
import { operationScope, type PendingOperation } from "../../api/idempotency";
import {
  MAX_PAGE_OFFSET,
  type MoneyRequestAccepted,
  type MoneyRequestCreate,
  type MoneyRequestRead,
  type MoneyRequestRole,
  type MoneyRequestStatus,
} from "../../api/types";

/** Solicitudes por página (2 columnas en escritorio). Muy por debajo del tope de 100 de la API. */
export const REQUESTS_PAGE_SIZE = 10;

export const ROLE_PARAM = "rol";
export const STATUS_PARAM = "estado";
export const PAGE_PARAM = "pagina";

const ROLE_VALUES = { recibidas: "received", enviadas: "sent" } as const satisfies Record<string, MoneyRequestRole>;
const STATUS_VALUES = {
  todas: null,
  pendientes: "PENDING",
  aceptadas: "ACCEPTED",
  rechazadas: "REJECTED",
  canceladas: "CANCELLED",
} as const satisfies Record<string, MoneyRequestStatus | null>;

export type StatusFilter = keyof typeof STATUS_VALUES;
export const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "todas", label: "Todas" },
  { id: "pendientes", label: "Pendientes" },
  { id: "aceptadas", label: "Aceptadas" },
  { id: "rechazadas", label: "Rechazadas" },
  { id: "canceladas", label: "Canceladas" },
];

export interface RequestParams {
  role: MoneyRequestRole;
  filter: StatusFilter;
  page: number;
}

const MAX_PAGE = Math.floor(MAX_PAGE_OFFSET / REQUESTS_PAGE_SIZE) + 1;

export function statusOf(filter: StatusFilter): MoneyRequestStatus | null {
  return STATUS_VALUES[filter];
}

export function parseRequestParams(search: URLSearchParams): RequestParams & { canonical: boolean } {
  const rawRole = search.get(ROLE_PARAM);
  const rawStatus = search.get(STATUS_PARAM);
  const rawPage = search.get(PAGE_PARAM);
  const role: MoneyRequestRole = rawRole !== null && rawRole in ROLE_VALUES ? ROLE_VALUES[rawRole as keyof typeof ROLE_VALUES] : "received";
  const filter: StatusFilter = rawStatus !== null && rawStatus in STATUS_VALUES ? (rawStatus as StatusFilter) : "todas";
  const pageNumber = rawPage !== null && /^\d{1,7}$/.test(rawPage) ? Number(rawPage) : NaN;
  const page = pageNumber >= 1 && pageNumber <= MAX_PAGE ? pageNumber : 1;
  const canonical =
    (rawRole === null || rawRole in ROLE_VALUES) &&
    (rawStatus === null || rawStatus in STATUS_VALUES) &&
    (rawPage === null || pageNumber === page);
  return { role, filter, page, canonical };
}

export function toRequestSearch({ role, filter, page }: RequestParams): Record<string, string> {
  return { [ROLE_PARAM]: role === "received" ? "recibidas" : "enviadas", [STATUS_PARAM]: filter, [PAGE_PARAM]: String(page) };
}

export function lastRequestPage(total: number): number {
  return Math.max(1, Math.min(Math.ceil(total / REQUESTS_PAGE_SIZE), MAX_PAGE));
}

// --- Crear ------------------------------------------------------------------------------------

export function createScope(accountId: string): string {
  return operationScope(accountId, "money_request_create");
}

export function validatePayer(raw: string, ownAccountId: string): string | null {
  const value = raw.trim();
  if (value === "") return "Ingresa el UUID de la cuenta que pagará.";
  if (!isUuid(value)) return "El UUID debe tener 36 caracteres con el formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.";
  if (value.toLowerCase() === ownAccountId.toLowerCase()) return "No puedes solicitarte dinero a ti mismo.";
  return null;
}

/** Cuerpo exacto de POST /money-requests (y huella de su Idempotency-Key). */
export function createPayload(payerId: string, amount: number, description: string | null): MoneyRequestCreate {
  const payload: MoneyRequestCreate = { payer_account_id: payerId.trim().toLowerCase(), amount };
  return description === null ? payload : { ...payload, description };
}

export function pendingCreate(operation: PendingOperation): MoneyRequestCreate | null {
  try {
    const data = JSON.parse(operation.fingerprint) as Record<string, unknown>;
    const { payer_account_id: payer, amount, description } = data;
    if (typeof payer !== "string" || !isUuid(payer)) return null;
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) return null;
    if (description !== undefined && typeof description !== "string") return null;
    return createPayload(payer, amount, description ?? null);
  } catch {
    return null;
  }
}

// --- Aceptar ----------------------------------------------------------------------------------

export function acceptScope(accountId: string, requestId: string): string {
  return operationScope(accountId, `accept:${requestId}`);
}

export function acceptPrefix(accountId: string): string {
  return operationScope(accountId, "accept:");
}

/** El id de la solicitud de un pago pendiente (la huella es {"request_id": ...}). */
export function pendingAcceptId(operation: PendingOperation): string | null {
  try {
    const id = (JSON.parse(operation.fingerprint) as Record<string, unknown>).request_id;
    return typeof id === "string" && isUuid(id) ? id : null;
  } catch {
    return null;
  }
}

// --- Respuestas -------------------------------------------------------------------------------

function isCounterparty(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return typeof data.account_id === "string" && isUuid(data.account_id) && typeof data.owner_name === "string";
}

export function isMoneyRequestRead(value: unknown): value is MoneyRequestRead {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.id === "string" &&
    isUuid(data.id) &&
    isCounterparty(data.requester) &&
    isCounterparty(data.payer) &&
    typeof data.amount === "number" &&
    Number.isSafeInteger(data.amount) &&
    typeof data.status === "string" &&
    ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED"].includes(data.status) &&
    typeof data.created_at === "string" &&
    (data.description === null || typeof data.description === "string")
  );
}

export function isMoneyRequestAccepted(value: unknown): value is MoneyRequestAccepted {
  return (
    isMoneyRequestRead(value) &&
    value.status === "ACCEPTED" &&
    typeof (value as unknown as Record<string, unknown>).balance === "number" &&
    Number.isSafeInteger((value as unknown as Record<string, unknown>).balance)
  );
}

export function invalidResponse(status: number): ApiError {
  return new ApiError("invalid_response", INVALID_RESPONSE_MESSAGE, status);
}
