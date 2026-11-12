/**
 * Tipos de la API, copiados de los schemas reales del backend (mismos nombres de campo):
 * - src/habicapital/accounts/schemas.py
 * - src/habicapital/ledger/schemas.py
 * - src/habicapital/money_requests/schemas.py y models.py
 * UUID y fechas llegan como texto (JSON). Los montos son pesos COP enteros.
 */

export type Uuid = string;
/** Fecha ISO 8601 con zona horaria, tal como la serializa FastAPI. */
export type IsoDateTime = string;

/** GET /health */
export interface Health {
  status: string;
}

// --- Cuentas (accounts/schemas.py) ----------------------------------------------------------

/** Body de POST /accounts. */
export interface AccountCreate {
  owner_name: string;
}

/** GET /accounts/me */
export interface AccountRead {
  id: Uuid;
  owner_name: string;
  balance: number;
  created_at: IsoDateTime;
}

/** POST /accounts (201). El token solo viene en esta respuesta. */
export interface AccountCreated extends AccountRead {
  token: string;
}

/** POST /accounts/me/token. Invalida el token anterior. */
export interface TokenRotated {
  token: string;
}

// --- Ledger (ledger/schemas.py) -------------------------------------------------------------

/** Body de POST /accounts/me/deposits. */
export interface DepositCreate {
  amount: number;
  description?: string | null;
}

export interface DepositRead {
  transaction_id: Uuid;
  amount: number;
  description: string | null;
  balance: number;
  created_at: IsoDateTime;
}

/** Body de POST /accounts/me/transfers. */
export interface TransferCreate {
  to_account_id: Uuid;
  amount: number;
  description?: string | null;
}

export interface TransferRead {
  transaction_id: Uuid;
  to_account_id: Uuid;
  amount: number;
  description: string | null;
  balance: number;
  created_at: IsoDateTime;
}

export type MovementType = "DEPOSIT" | "TRANSFER_SENT" | "TRANSFER_RECEIVED";
export type Direction = "IN" | "OUT";
export type SortOrder = "desc" | "asc";

export interface Counterparty {
  account_id: Uuid;
  owner_name: string;
}

export interface MovementRead {
  transaction_id: Uuid;
  type: MovementType;
  direction: Direction;
  amount: number;
  balance_after: number;
  description: string | null;
  /** null en los depósitos. */
  counterparty: Counterparty | null;
  created_at: IsoDateTime;
}

/** GET /accounts/me/movements */
export interface MovementPage {
  items: MovementRead[];
  total: number;
  limit: number;
  offset: number;
  order: SortOrder;
}

// --- Solicitudes de dinero (money_requests/schemas.py) --------------------------------------

export type MoneyRequestStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "CANCELLED";
export type MoneyRequestRole = "sent" | "received";

/** Body de POST /money-requests. */
export interface MoneyRequestCreate {
  payer_account_id: Uuid;
  amount: number;
  description?: string | null;
}

export interface MoneyRequestRead {
  id: Uuid;
  requester: Counterparty;
  payer: Counterparty;
  amount: number;
  description: string | null;
  status: MoneyRequestStatus;
  transaction_id: Uuid | null;
  created_at: IsoDateTime;
  resolved_at: IsoDateTime | null;
}

/** POST /money-requests/{id}/accept (200): incluye el saldo del pagador después de pagar. */
export interface MoneyRequestAccepted extends MoneyRequestRead {
  balance: number;
}

/** GET /money-requests */
export interface MoneyRequestPage {
  items: MoneyRequestRead[];
  total: number;
  limit: number;
  offset: number;
  order: SortOrder;
  role: MoneyRequestRole;
  status: MoneyRequestStatus | null;
}

// --- Límites de validación del backend ------------------------------------------------------

/** ledger/service.py: MAX_DEPOSIT_COP y MAX_TRANSFER_COP (los montos además son > 0). */
export const MAX_DEPOSIT_COP = 10_000_000;
export const MAX_TRANSFER_COP = 10_000_000;
/** ledger/models.py: DESCRIPTION_MAX_LENGTH (también en solicitudes). */
export const DESCRIPTION_MAX_LENGTH = 140;
/** accounts/models.py: OWNER_NAME_MAX_LENGTH. */
export const OWNER_NAME_MAX_LENGTH = 100;
/** idempotency/models.py y el patrón del header en ledger/router.py. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 100;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
/** Topes de paginación de movimientos y solicitudes. */
export const MAX_PAGE_LIMIT = 100;
export const MAX_PAGE_OFFSET = 1_000_000;
