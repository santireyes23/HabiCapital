/**
 * Claves de idempotencia para operaciones de dinero (recargar, transferir, crear y aceptar
 * solicitudes).
 *
 * Regla: una clave identifica UNA intención del usuario (cuenta + operación + datos).
 * - Mientras el resultado sea incierto (sin respuesta, timeout, 5xx), la operación queda
 *   pendiente y cualquier reintento usa la MISMA clave: el backend devuelve el resultado original
 *   sin mover dinero dos veces. Nunca se genera una clave nueva automáticamente.
 * - Si el usuario intenta otra operación distinta en el mismo ámbito mientras hay una incierta,
 *   se lanza PendingOperationConflictError: la interfaz debe reintentar la pendiente o pedir al
 *   usuario que la descarte de forma explícita (`discard`).
 * - Con una respuesta definitiva (éxito o rechazo del servidor) la operación se cierra y la
 *   siguiente intención recibe una clave nueva.
 *
 * Las operaciones pendientes se guardan en sessionStorage para sobrevivir a una recarga.
 * Solo contienen datos de la operación (monto, UUID, descripción), nunca el token.
 */

import type { ApiResponse } from "./client";
import { ApiError } from "./errors";
import { browserSessionStore, type KeyValueStore } from "../lib/safeStorage";

export const PENDING_OPERATIONS_STORAGE_KEY = "habicapital.pending-operations";

export interface PendingOperation {
  /** Cuenta + operación, p. ej. "<uuid>:transfer" o "<uuid>:accept:<id de solicitud>". */
  scope: string;
  /** Datos de la operación en JSON canónico (claves ordenadas). */
  fingerprint: string;
  key: string;
  createdAt: string;
}

export class PendingOperationConflictError extends Error {
  readonly pending: PendingOperation;

  constructor(pending: PendingOperation) {
    super("Hay una operación anterior sin confirmar. Reintenta esa operación o descártala.");
    this.name = "PendingOperationConflictError";
    this.pending = pending;
  }
}

/** JSON con las claves de los objetos ordenadas: el mismo payload da siempre el mismo texto. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    );
  });
}

export function operationScope(accountId: string, operation: string): string {
  return `${accountId}:${operation}`;
}

function isPendingOperation(value: unknown): value is PendingOperation {
  if (typeof value !== "object" || value === null) return false;
  const op = value as Record<string, unknown>;
  return (
    typeof op.scope === "string" &&
    typeof op.fingerprint === "string" &&
    typeof op.key === "string" &&
    typeof op.createdAt === "string"
  );
}

function without(
  operations: Record<string, PendingOperation>,
  scope: string,
): Record<string, PendingOperation> {
  return Object.fromEntries(Object.entries(operations).filter(([name]) => name !== scope));
}

export interface IdempotencyOptions {
  store?: KeyValueStore;
  newKey?: () => string;
  now?: () => Date;
}

export function createIdempotencyManager(options: IdempotencyOptions = {}) {
  const store = options.store ?? browserSessionStore();
  const newKey = options.newKey ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date());

  function readAll(): Record<string, PendingOperation> {
    const raw = store.get(PENDING_OPERATIONS_STORAGE_KEY);
    if (raw === null) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, PendingOperation] =>
            isPendingOperation(entry[1]) && entry[1].scope === entry[0],
        ),
      );
    } catch {
      return {};
    }
  }

  function writeAll(operations: Record<string, PendingOperation>) {
    if (Object.keys(operations).length === 0) store.remove(PENDING_OPERATIONS_STORAGE_KEY);
    else store.set(PENDING_OPERATIONS_STORAGE_KEY, JSON.stringify(operations));
  }

  /** La operación incierta de ese ámbito, si la hay (para ofrecer «Reintentar»). */
  function pending(scope: string): PendingOperation | null {
    return readAll()[scope] ?? null;
  }

  /**
   * Clave para enviar esta operación. Si ya hay una pendiente con los mismos datos, devuelve su
   * clave (reintento). Si hay una pendiente con otros datos, lanza PendingOperationConflictError.
   */
  function begin(scope: string, payload: unknown): PendingOperation {
    const fingerprint = canonicalJson(payload);
    const operations = readAll();
    const existing = operations[scope];
    if (existing !== undefined) {
      if (existing.fingerprint === fingerprint) return existing;
      throw new PendingOperationConflictError(existing);
    }
    const operation: PendingOperation = {
      scope,
      fingerprint,
      key: newKey(),
      createdAt: now().toISOString(),
    };
    writeAll({ ...operations, [scope]: operation });
    return operation;
  }

  /** Cierra la operación tras una respuesta definitiva. Solo si la clave coincide. */
  function settle(scope: string, key: string): void {
    const operations = readAll();
    if (operations[scope]?.key !== key) return;
    writeAll(without(operations, scope));
  }

  /** El usuario decide abandonar una operación incierta (no se reintentará). */
  function discard(scope: string): void {
    const operations = readAll();
    if (!(scope in operations)) return;
    writeAll(without(operations, scope));
  }

  /**
   * Al cerrar sesión: borra las operaciones pendientes de esa cuenta para que nadie más en esta
   * pestaña vea sus montos o destinatarios. Las de otras cuentas no se tocan.
   */
  function discardAccount(accountId: string): void {
    const prefix = operationScope(accountId, "");
    const operations = readAll();
    const kept = Object.fromEntries(
      Object.entries(operations).filter(([scope]) => !scope.startsWith(prefix)),
    );
    if (Object.keys(kept).length !== Object.keys(operations).length) writeAll(kept);
  }

  /**
   * Ejecuta `send` con la clave de esta intención.
   * - Éxito: cierra la operación.
   * - Error incierto (red, timeout, 5xx, respuesta ilegible): la deja pendiente con su clave.
   * - Rechazo definitivo del servidor (4xx): la cierra; ese intento no movió dinero.
   */
  async function run<T>(
    scope: string,
    payload: unknown,
    send: (key: string) => Promise<ApiResponse<T>>,
  ): Promise<ApiResponse<T>> {
    const operation = begin(scope, payload);
    try {
      const response = await send(operation.key);
      settle(scope, operation.key);
      return response;
    } catch (error) {
      if (error instanceof ApiError && !error.outcomeUncertain) settle(scope, operation.key);
      throw error;
    }
  }

  /** Operaciones pendientes cuyo ámbito empieza por `prefix` (p. ej. todos los pagos de solicitudes). */
  function pendingByPrefix(prefix: string): PendingOperation[] {
    return Object.values(readAll()).filter((operation) => operation.scope.startsWith(prefix));
  }

  /** Borra todas las operaciones pendientes de esta pestaña (cierre de sesión sin cuenta conocida). */
  function discardAll(): void {
    store.remove(PENDING_OPERATIONS_STORAGE_KEY);
  }

  return { begin, pending, pendingByPrefix, settle, discard, discardAccount, discardAll, run };
}

export type IdempotencyManager = ReturnType<typeof createIdempotencyManager>;
