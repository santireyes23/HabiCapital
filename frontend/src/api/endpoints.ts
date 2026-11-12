/**
 * Los 13 endpoints reales del backend (routers de accounts, ledger y money_requests, más /health).
 * No hay ninguno más: si el backend no lo ofrece, aquí no existe.
 */

import type { ApiClient, ApiResponse } from "./client";
import type {
  AccountCreate,
  AccountCreated,
  AccountRead,
  DepositCreate,
  DepositRead,
  Health,
  MoneyRequestAccepted,
  MoneyRequestCreate,
  MoneyRequestPage,
  MoneyRequestRead,
  MoneyRequestRole,
  MoneyRequestStatus,
  MovementPage,
  SortOrder,
  TokenRotated,
  TransferCreate,
  TransferRead,
  Uuid,
} from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Un id que va en la ruta debe ser un UUID: evita rutas manipuladas (../, ?, #). */
function pathId(id: Uuid): string {
  if (!isUuid(id)) throw new Error("Identificador inválido");
  return id.toLowerCase();
}

export interface PageQuery {
  limit?: number;
  offset?: number;
  order?: SortOrder;
}

export interface MoneyRequestQuery extends PageQuery {
  role: MoneyRequestRole;
  status?: MoneyRequestStatus;
}

export function createEndpoints(client: ApiClient) {
  return {
    /** GET /health (público). */
    health: (): Promise<ApiResponse<Health>> => client.request("GET", "/health", { auth: false }),

    /** POST /accounts (público): devuelve el token una sola vez. */
    createAccount: (payload: AccountCreate): Promise<ApiResponse<AccountCreated>> =>
      client.request("POST", "/accounts", { body: payload, auth: false }),

    /**
     * GET /accounts/me. Con `token` valida ese token sin usar (ni cerrar) la sesión actual:
     * así se comprueba una credencial antes de guardarla.
     */
    getMe: (options: { token?: string; signal?: AbortSignal } = {}): Promise<
      ApiResponse<AccountRead>
    > => client.request("GET", "/accounts/me", { ...options }),

    /** POST /accounts/me/token: el token anterior deja de funcionar. */
    rotateToken: (): Promise<ApiResponse<TokenRotated>> =>
      client.request("POST", "/accounts/me/token"),

    /** POST /accounts/me/deposits (201, idempotente). */
    deposit: (payload: DepositCreate, idempotencyKey: string): Promise<ApiResponse<DepositRead>> =>
      client.request("POST", "/accounts/me/deposits", { body: payload, idempotencyKey }),

    /** POST /accounts/me/transfers (201, idempotente). */
    transfer: (
      payload: TransferCreate,
      idempotencyKey: string,
    ): Promise<ApiResponse<TransferRead>> =>
      client.request("POST", "/accounts/me/transfers", { body: payload, idempotencyKey }),

    /** GET /accounts/me/movements */
    listMovements: (
      query: PageQuery = {},
      options: { signal?: AbortSignal } = {},
    ): Promise<ApiResponse<MovementPage>> =>
      client.request("GET", "/accounts/me/movements", { query: { ...query }, ...options }),

    /** POST /money-requests (201, idempotente). No mueve dinero. */
    createMoneyRequest: (
      payload: MoneyRequestCreate,
      idempotencyKey: string,
    ): Promise<ApiResponse<MoneyRequestRead>> =>
      client.request("POST", "/money-requests", { body: payload, idempotencyKey }),

    /** GET /money-requests (role obligatorio). */
    listMoneyRequests: (
      query: MoneyRequestQuery,
      options: { signal?: AbortSignal } = {},
    ): Promise<ApiResponse<MoneyRequestPage>> =>
      client.request("GET", "/money-requests", { query: { ...query }, ...options }),

    /** GET /money-requests/{id} */
    getMoneyRequest: (id: Uuid): Promise<ApiResponse<MoneyRequestRead>> =>
      client.request("GET", `/money-requests/${pathId(id)}`),

    /** POST /money-requests/{id}/reject (solo el pagador). */
    rejectMoneyRequest: (id: Uuid): Promise<ApiResponse<MoneyRequestRead>> =>
      client.request("POST", `/money-requests/${pathId(id)}/reject`),

    /** POST /money-requests/{id}/cancel (solo el solicitante). */
    cancelMoneyRequest: (id: Uuid): Promise<ApiResponse<MoneyRequestRead>> =>
      client.request("POST", `/money-requests/${pathId(id)}/cancel`),

    /** POST /money-requests/{id}/accept (200, idempotente): paga la solicitud. */
    acceptMoneyRequest: (
      id: Uuid,
      idempotencyKey: string,
    ): Promise<ApiResponse<MoneyRequestAccepted>> =>
      client.request("POST", `/money-requests/${pathId(id)}/accept`, { idempotencyKey }),
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
