import { describe, expect, it, vi } from "vitest";

import { memoryStore } from "../lib/safeStorage";
import type { ApiResponse } from "./client";
import { ApiError } from "./errors";
import {
  canonicalJson,
  createIdempotencyManager,
  operationScope,
  PENDING_OPERATIONS_STORAGE_KEY,
  PendingOperationConflictError,
} from "./idempotency";

const ACCOUNT = "e8d24a91-9c3f-4e12-b7a4-6102f83c5d99";
const SCOPE = operationScope(ACCOUNT, "transfer");
const PAYLOAD = { to_account_id: "4f9b2d8e-17c3-4d62-a58f-90e8c71b3e21", amount: 150_000 };

function setup() {
  const store = memoryStore();
  let counter = 0;
  const manager = createIdempotencyManager({
    store,
    newKey: () => `key-${++counter}`,
    now: () => new Date("2026-11-12T15:00:00Z"),
  });
  return { manager, store };
}

const ok = <T>(data: T): ApiResponse<T> => ({ data, status: 201, replayed: false });

describe("claves de idempotencia", () => {
  it("el JSON canónico no depende del orden de las claves", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("éxito: usa una clave y la cierra; la siguiente intención recibe otra", async () => {
    const { manager } = setup();
    const send = vi.fn((key: string) => Promise.resolve(ok({ key })));

    await manager.run(SCOPE, PAYLOAD, send);
    await manager.run(SCOPE, PAYLOAD, send);

    expect(send.mock.calls.map(([key]) => key)).toEqual(["key-1", "key-2"]);
    expect(manager.pending(SCOPE)).toBeNull();
  });

  it.each([
    ["error de red", new ApiError("network", "sin red")],
    ["timeout", new ApiError("timeout", "lento")],
    ["error 5xx", new ApiError("http", "fallo", 503)],
    ["respuesta ilegible", new ApiError("invalid_response", "?", 200)],
  ])("%s: conserva la MISMA clave para el reintento", async (_name, failure) => {
    const { manager } = setup();
    const send = vi
      .fn<(key: string) => Promise<ApiResponse<string>>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(ok("hecho"));

    await expect(manager.run(SCOPE, PAYLOAD, send)).rejects.toBe(failure);
    expect(manager.pending(SCOPE)?.key).toBe("key-1");

    // Reintento con los mismos datos (aunque el objeto llegue con otro orden de claves).
    await manager.run(SCOPE, { amount: 150_000, to_account_id: PAYLOAD.to_account_id }, send);

    expect(send.mock.calls.map(([key]) => key)).toEqual(["key-1", "key-1"]);
    expect(manager.pending(SCOPE)).toBeNull();
  });

  it("una cancelación del navegador (no ApiError) también deja la operación pendiente", async () => {
    const { manager } = setup();
    const abort = new DOMException("aborted", "AbortError");
    await expect(manager.run(SCOPE, PAYLOAD, () => Promise.reject(abort))).rejects.toBe(abort);
    expect(manager.pending(SCOPE)?.key).toBe("key-1");
  });

  it.each([
    ["saldo insuficiente (409)", new ApiError("http", "Saldo insuficiente", 409)],
    ["destino inexistente (404)", new ApiError("http", "Cuenta de destino no encontrada", 404)],
    ["validación (422)", new ApiError("validation", "Revisa", 422)],
    ["token inválido (401)", new ApiError("http", "Token ausente o inválido", 401)],
  ])("rechazo definitivo, %s: cierra la operación", async (_name, failure) => {
    const { manager } = setup();
    await expect(manager.run(SCOPE, PAYLOAD, () => Promise.reject(failure))).rejects.toBe(failure);
    expect(manager.pending(SCOPE)).toBeNull();
  });

  it("con una operación incierta, otros datos NO reciben una clave nueva automáticamente", async () => {
    const { manager } = setup();
    await expect(
      manager.run(SCOPE, PAYLOAD, () => Promise.reject(new ApiError("timeout", "lento"))),
    ).rejects.toBeInstanceOf(ApiError);

    const send = vi.fn((key: string) => Promise.resolve(ok(key)));
    const conflict = manager.run(SCOPE, { ...PAYLOAD, amount: 200_000 }, send);

    await expect(conflict).rejects.toBeInstanceOf(PendingOperationConflictError);
    expect(send).not.toHaveBeenCalled();
    expect(manager.pending(SCOPE)?.key).toBe("key-1");
  });

  it("solo tras descartarla explícitamente se puede empezar otra operación", () => {
    const { manager } = setup();
    manager.begin(SCOPE, PAYLOAD);
    manager.discard(SCOPE);
    expect(manager.begin(SCOPE, { ...PAYLOAD, amount: 1 }).key).toBe("key-2");
  });

  it("los ámbitos son independientes por cuenta y operación", () => {
    const { manager } = setup();
    const transfer = manager.begin(SCOPE, PAYLOAD);
    const deposit = manager.begin(operationScope(ACCOUNT, "deposit"), { amount: 1 });
    const other = manager.begin(operationScope("otra-cuenta", "transfer"), PAYLOAD);
    expect(new Set([transfer.key, deposit.key, other.key]).size).toBe(3);
  });

  it("settle con una clave que no coincide no borra la operación pendiente", () => {
    const { manager } = setup();
    manager.begin(SCOPE, PAYLOAD);
    manager.settle(SCOPE, "otra-clave");
    expect(manager.pending(SCOPE)?.key).toBe("key-1");
  });

  it("la operación pendiente sobrevive a una recarga (mismo almacenamiento)", () => {
    const { manager, store } = setup();
    manager.begin(SCOPE, PAYLOAD);

    const reloaded = createIdempotencyManager({ store, newKey: () => "nueva" });
    expect(reloaded.begin(SCOPE, PAYLOAD).key).toBe("key-1");
  });

  it("no guarda el token ni nada fuera de los datos de la operación", () => {
    const { manager, store } = setup();
    manager.begin(SCOPE, PAYLOAD);
    const saved = JSON.parse(store.get(PENDING_OPERATIONS_STORAGE_KEY) ?? "{}") as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(saved[SCOPE] ?? {}).sort()).toEqual(["createdAt", "fingerprint", "key", "scope"]);
  });

  it("ignora datos corruptos en el almacenamiento", () => {
    const { manager, store } = setup();
    store.set(PENDING_OPERATIONS_STORAGE_KEY, "{no es json");
    expect(manager.pending(SCOPE)).toBeNull();
    store.set(PENDING_OPERATIONS_STORAGE_KEY, JSON.stringify({ [SCOPE]: { key: 1 } }));
    expect(manager.begin(SCOPE, PAYLOAD).key).toBe("key-1");
  });

  it("genera claves UUID aceptadas por el backend por defecto", () => {
    const manager = createIdempotencyManager({ store: memoryStore() });
    expect(manager.begin(SCOPE, PAYLOAD).key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
