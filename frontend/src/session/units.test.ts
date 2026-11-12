import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "../api/client";
import { createEndpoints } from "../api/endpoints";
import { createIdempotencyManager, operationScope } from "../api/idempotency";
import { initials, shortUuid } from "../lib/account";
import { memoryStore } from "../lib/safeStorage";
import { validateOwnerName } from "../pages/access/CreateAccountForm";
import { safeRedirectPath } from "../pages/access/redirect";
import { fakeFetch, jsonResponse } from "../test/http";
import { isAccountCreated, isAccountRead, publicAccount } from "./accountResponse";

const ACCOUNT = {
  id: "e8d24a91-9c3f-4e12-b7a4-6102f83c5d99",
  owner_name: "Camilo Aristizábal",
  balance: 0,
  created_at: "2026-11-12T15:00:00+00:00",
};

describe("validar el token con una llamada puntual (getMe con token)", () => {
  it("usa ese token en Authorization en lugar del de la sesión", async () => {
    const { fetchFn, requests } = fakeFetch(() => jsonResponse(200, ACCOUNT));
    const api = createEndpoints(createApiClient({ getToken: () => "sesion", fetchFn }));
    await api.getMe({ token: "candidato" });
    expect(requests[0]?.headers.get("Authorization")).toBe("Bearer candidato");
  });

  it("un 401 con ese token NO cierra la sesión actual", async () => {
    const onUnauthorized = vi.fn();
    const { fetchFn } = fakeFetch(() => jsonResponse(401, { detail: "Token ausente o inválido" }));
    const api = createEndpoints(createApiClient({ getToken: () => "sesion", fetchFn, onUnauthorized }));
    await expect(api.getMe({ token: "candidato" })).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("un 401 con el token de la sesión sí la cierra", async () => {
    const onUnauthorized = vi.fn();
    const { fetchFn } = fakeFetch(() => jsonResponse(401, { detail: "Token ausente o inválido" }));
    const api = createEndpoints(createApiClient({ getToken: () => "sesion", fetchFn, onUnauthorized }));
    await expect(api.getMe()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});

describe("respuestas de cuenta", () => {
  it("acepta la forma real de AccountRead y AccountCreated", () => {
    expect(isAccountRead(ACCOUNT)).toBe(true);
    expect(isAccountCreated({ ...ACCOUNT, token: "Zx9_abc-DEF" })).toBe(true);
  });

  it.each([
    ["sin token", ACCOUNT],
    ["token con espacios", { ...ACCOUNT, token: "a b" }],
    ["id que no es UUID", { ...ACCOUNT, id: "usr_9021", token: "x" }],
    ["saldo decimal", { ...ACCOUNT, balance: 1.5, token: "x" }],
    ["no es un objeto", "ok"],
  ])("rechaza una creación inválida: %s", (_name, value) => {
    expect(isAccountCreated(value)).toBe(false);
  });

  it("publicAccount nunca copia el token", () => {
    const copy = publicAccount({ ...ACCOUNT, token: "secreto" } as typeof ACCOUNT);
    expect(JSON.stringify(copy)).not.toContain("secreto");
  });
});

describe("nombre del titular (límites del backend)", () => {
  it("acepta 1 a 100 caracteres tras quitar espacios", () => {
    expect(validateOwnerName(" Ana ")).toBeNull();
    expect(validateOwnerName("a".repeat(100))).toBeNull();
    expect(validateOwnerName("ñ".repeat(100))).toBeNull();
  });

  it("rechaza vacío y más de 100 caracteres (contados como Python)", () => {
    expect(validateOwnerName("   ")).not.toBeNull();
    expect(validateOwnerName("a".repeat(101))).not.toBeNull();
    // 100 emojis ocupan 200 unidades UTF-16 pero son 100 caracteres para el backend.
    expect(validateOwnerName("😀".repeat(100))).toBeNull();
  });
});

describe("destino después de iniciar sesión", () => {
  it.each(["/", "/movimientos", "/solicitudes?rol=enviadas", "/cuenta"])("acepta %s", (from) => {
    expect(safeRedirectPath({ from })).toBe(from);
  });

  it.each([
    "https://evil.example",
    "//evil.example/x",
    "/\\evil.example",
    "/acceso",
    "/admin",
    "movimientos",
  ])("rechaza %s", (from) => {
    expect(safeRedirectPath({ from })).toBeNull();
  });

  it("ignora estados sin ruta", () => {
    expect(safeRedirectPath(null)).toBeNull();
    expect(safeRedirectPath({ from: 3 })).toBeNull();
  });
});

describe("datos públicos de la cuenta", () => {
  it("iniciales y UUID abreviado como en la barra lateral", () => {
    expect(initials("Camilo Aristizábal")).toBe("CA");
    expect(initials("  valentina  de la  gómez ")).toBe("VG");
    expect(initials("Ana")).toBe("AN");
    expect(shortUuid(ACCOUNT.id)).toBe("e8d2...5d99");
  });
});

describe("operaciones pendientes al cerrar sesión", () => {
  it("discardAccount borra solo las de esa cuenta; discardAll, todas", () => {
    const manager = createIdempotencyManager({ store: memoryStore() });
    manager.begin(operationScope("cuenta-a", "transfer"), { amount: 1 });
    manager.begin(operationScope("cuenta-a", "deposit"), { amount: 2 });
    manager.begin(operationScope("cuenta-b", "transfer"), { amount: 3 });

    manager.discardAccount("cuenta-a");
    expect(manager.pending(operationScope("cuenta-a", "transfer"))).toBeNull();
    expect(manager.pending(operationScope("cuenta-a", "deposit"))).toBeNull();
    expect(manager.pending(operationScope("cuenta-b", "transfer"))).not.toBeNull();

    manager.discardAll();
    expect(manager.pending(operationScope("cuenta-b", "transfer"))).toBeNull();
  });
});
