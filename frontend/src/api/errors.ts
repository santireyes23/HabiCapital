/**
 * Errores de la API normalizados. FastAPI responde dos formatos:
 * - errores de negocio (errors.py): {"detail": "texto"}
 * - validación (422 de FastAPI):     {"detail": [{"loc": [...], "msg": "...", "type": "..."}]}
 *
 * Los mensajes nunca incluyen el token ni cabeceras de la petición: solo el texto que devolvió
 * el servidor o un mensaje fijo.
 */

export type ApiErrorKind =
  | "http" // respuesta del servidor con status de error y detail de texto
  | "validation" // 422 de FastAPI con errores por campo
  | "network" // no hubo respuesta (servidor caído, sin red, proxy sin backend)
  | "timeout" // se agotó el tiempo de espera
  | "invalid_response"; // respuesta 2xx que no es el JSON esperado

export interface FieldError {
  /** Ruta del campo sin el origen: "amount", "to_account_id", "Idempotency-Key". */
  field: string;
  /** Origen según FastAPI: "body", "query", "path", "header". */
  location: string;
  message: string;
}

export const NETWORK_ERROR_MESSAGE = "No se pudo conectar con el servidor de HabiCapital.";
export const TIMEOUT_ERROR_MESSAGE = "El servidor tardó demasiado en responder.";
export const INVALID_RESPONSE_MESSAGE = "El servidor devolvió una respuesta inesperada.";
export const VALIDATION_ERROR_MESSAGE = "Revisa los datos enviados.";
const GENERIC_HTTP_MESSAGE = "El servidor no pudo completar la solicitud.";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** Status HTTP, o null si no hubo respuesta. */
  readonly status: number | null;
  readonly fieldErrors: readonly FieldError[];

  constructor(
    kind: ApiErrorKind,
    message: string,
    status: number | null = null,
    fieldErrors: readonly FieldError[] = [],
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }

  /**
   * true si no se sabe si la operación se aplicó: sin respuesta, timeout, error 5xx o respuesta
   * ilegible. En operaciones de dinero se debe reintentar con la MISMA Idempotency-Key.
   */
  get outcomeUncertain(): boolean {
    return (
      this.kind === "network" ||
      this.kind === "timeout" ||
      this.kind === "invalid_response" ||
      (this.status !== null && this.status >= 500)
    );
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFieldError(item: unknown): FieldError | null {
  if (!isRecord(item) || typeof item.msg !== "string" || !Array.isArray(item.loc)) return null;
  const loc = item.loc.map(String);
  const [location = "", ...path] = loc;
  return { location, field: path.join("."), message: item.msg };
}

/** Construye el ApiError de una respuesta con status de error a partir de su cuerpo (ya leído). */
export function errorFromResponse(status: number, body: unknown): ApiError {
  const detail = isRecord(body) ? body.detail : undefined;

  if (typeof detail === "string" && detail.trim() !== "") {
    return new ApiError("http", detail, status);
  }
  if (Array.isArray(detail)) {
    const fields = detail.map(toFieldError).filter((f): f is FieldError => f !== null);
    return new ApiError("validation", VALIDATION_ERROR_MESSAGE, status, fields);
  }
  return new ApiError("http", GENERIC_HTTP_MESSAGE, status);
}
