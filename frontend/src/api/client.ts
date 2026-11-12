/**
 * Cliente HTTP de la API de HabiCapital.
 *
 * - Todas las rutas van a /api (mismo origen); el proxy de Vite las reenvía a FastAPI.
 * - El token Bearer se pide en cada llamada a `getToken` y solo se envía en la cabecera
 *   Authorization: nunca en la URL, en logs ni en mensajes de error.
 * - La Idempotency-Key la decide quien llama (ver idempotency.ts); el cliente solo la envía.
 */

import {
  ApiError,
  errorFromResponse,
  INVALID_RESPONSE_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
} from "./errors";
import { IDEMPOTENCY_KEY_MAX_LENGTH, IDEMPOTENCY_KEY_PATTERN } from "./types";

export const API_BASE_PATH = "/api";
export const DEFAULT_TIMEOUT_MS = 15_000;

export type HttpMethod = "GET" | "POST";
export type QueryValue = string | number | null | undefined;

export interface RequestOptions {
  /** Cuerpo JSON. */
  body?: unknown;
  /** Parámetros de consulta; null y undefined se omiten. */
  query?: Record<string, QueryValue>;
  /** false para los endpoints públicos (salud y crear cuenta). Por defecto true. */
  auth?: boolean;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /**
   * Token para esta única llamada, en lugar del de la sesión: sirve para validar un token antes
   * de guardarlo (acceso con «Ya tengo cuenta»). Un 401 con este token no cierra la sesión.
   */
  token?: string;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  /** El servidor devolvió la respuesta guardada para esa Idempotency-Key (no volvió a ejecutar). */
  replayed: boolean;
}

export interface ApiClientConfig {
  getToken: () => string | null;
  /** Se llama cuando una petición autenticada recibe 401 (token inválido o regenerado). */
  onUnauthorized?: () => void;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface ApiClient {
  request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<ApiResponse<T>>;
}

/** Valida la clave antes de enviarla, con el mismo patrón y longitud que exige el backend. */
export function assertValidIdempotencyKey(key: string): void {
  if (
    key.length === 0 ||
    key.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
    !IDEMPOTENCY_KEY_PATTERN.test(key)
  ) {
    throw new Error("Idempotency-Key inválida");
  }
}

export function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
  if (!path.startsWith("/")) throw new Error("La ruta debe empezar por /");
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined) params.append(name, String(value));
  }
  const search = params.toString();
  return `${baseUrl}${path}${search === "" ? "" : `?${search}`}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const baseUrl = config.baseUrl ?? API_BASE_PATH;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchFn = config.fetchFn ?? globalThis.fetch.bind(globalThis);

  async function request<T>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const { body, query, auth = true, idempotencyKey, signal, token: explicitToken } = options;
    // Solo un 401 del token de la sesión debe cerrar la sesión.
    const usesSessionToken = auth && explicitToken === undefined;

    const headers = new Headers({ Accept: "application/json" });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (idempotencyKey !== undefined) {
      assertValidIdempotencyKey(idempotencyKey);
      headers.set("Idempotency-Key", idempotencyKey);
    }
    if (auth) {
      const token = explicitToken ?? config.getToken();
      // Sin token no se llama al servidor: el resultado sería un 401 seguro.
      if (token === null) {
        config.onUnauthorized?.();
        throw new ApiError("http", "Token ausente o inválido", 401);
      }
      headers.set("Authorization", `Bearer ${token}`);
    }

    // Timeout propio, combinado con la señal de quien llama (p. ej. al desmontar un componente).
    const controller = new AbortController();
    const timeoutReason = new Error("timeout");
    const timer = setTimeout(() => {
      controller.abort(timeoutReason);
    }, timeoutMs);
    const forwardAbort = () => {
      controller.abort();
    };
    signal?.addEventListener("abort", forwardAbort, { once: true });

    let response: Response;
    try {
      response = await fetchFn(buildUrl(baseUrl, path, query), {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
        signal: controller.signal,
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch (error) {
      if (controller.signal.reason === timeoutReason) {
        throw new ApiError("timeout", TIMEOUT_ERROR_MESSAGE);
      }
      // Cancelación pedida por quien llama: se propaga tal cual (no es un fallo de red).
      if (signal?.aborted === true) throw error;
      throw new ApiError("network", NETWORK_ERROR_MESSAGE);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
    }

    const payload = await readJson(response);

    if (!response.ok) {
      const error = errorFromResponse(response.status, payload);
      if (response.status === 401 && usesSessionToken) config.onUnauthorized?.();
      throw error;
    }
    if (payload === undefined) {
      throw new ApiError("invalid_response", INVALID_RESPONSE_MESSAGE, response.status);
    }
    return {
      data: payload as T,
      status: response.status,
      replayed: response.headers.get("Idempotent-Replayed") === "true",
    };
  }

  return { request };
}
