import { describe, expect, it } from "vitest";

import type { PendingOperation } from "../../api/idempotency";
import {
  acceptPrefix,
  acceptScope,
  createPayload,
  lastRequestPage,
  parseRequestParams,
  pendingAcceptId,
  pendingCreate,
  toRequestSearch,
  validatePayer,
} from "./requests";

const ME = "00000000-0000-4000-8000-000000000001";
const OTHER = "4F9B2D8E-17C3-4D62-A58F-90E8C71B3E21";
const op = (fingerprint: string): PendingOperation => ({ scope: "x", key: "k", fingerprint, createdAt: "2026-11-12T15:00:00Z" });

describe("parámetros de Solicitudes en la URL", () => {
  it("valores válidos y su forma canónica", () => {
    const parsed = parseRequestParams(new URLSearchParams("rol=enviadas&estado=aceptadas&pagina=3"));
    expect(parsed).toEqual({ role: "sent", filter: "aceptadas", page: 3, canonical: true });
    expect(toRequestSearch(parsed)).toEqual({ rol: "enviadas", estado: "aceptadas", pagina: "3" });
  });

  it.each(["rol=x", "estado=PENDING", "pagina=0", "pagina=-1", "pagina=1.5", "pagina=99999999"])("%s no es canónico", (query) => {
    const parsed = parseRequestParams(new URLSearchParams(query));
    expect(parsed.canonical).toBe(false);
    expect(parsed.page).toBeGreaterThanOrEqual(1);
  });

  it("sin parámetros: recibidas, todas, página 1", () => {
    expect(parseRequestParams(new URLSearchParams())).toEqual({ role: "received", filter: "todas", page: 1, canonical: true });
  });

  it("última página", () => {
    expect(lastRequestPage(0)).toBe(1);
    expect(lastRequestPage(10)).toBe(1);
    expect(lastRequestPage(11)).toBe(2);
  });
});

describe("crear solicitud", () => {
  it("valida el pagador", () => {
    expect(validatePayer("  ", ME)).toBe("Ingresa el UUID de la cuenta que pagará.");
    expect(validatePayer("abc", ME)).toMatch(/36 caracteres/);
    expect(validatePayer(ME.toUpperCase(), ME)).toBe("No puedes solicitarte dinero a ti mismo.");
    expect(validatePayer(` ${OTHER} `, ME)).toBeNull();
  });

  it("cuerpo: UUID en minúsculas y concepto omitido si no hay", () => {
    expect(createPayload(` ${OTHER} `, 1_000, null)).toEqual({ payer_account_id: OTHER.toLowerCase(), amount: 1_000 });
    expect(createPayload(OTHER, 1_000, "Pago")).toEqual({ payer_account_id: OTHER.toLowerCase(), amount: 1_000, description: "Pago" });
  });

  it("lee la solicitud pendiente guardada y rechaza datos corruptos", () => {
    expect(pendingCreate(op(JSON.stringify({ payer_account_id: OTHER, amount: 5 })))).toEqual({
      payer_account_id: OTHER.toLowerCase(),
      amount: 5,
    });
    expect(pendingCreate(op("{"))).toBeNull();
    expect(pendingCreate(op(JSON.stringify({ payer_account_id: "x", amount: 5 })))).toBeNull();
    expect(pendingCreate(op(JSON.stringify({ payer_account_id: OTHER, amount: -1 })))).toBeNull();
    expect(pendingCreate(op(JSON.stringify({ payer_account_id: OTHER, amount: 5, description: 3 })))).toBeNull();
  });
});

describe("aceptar solicitud", () => {
  it("el alcance de cada pago empieza por el prefijo de la cuenta", () => {
    expect(acceptScope(ME, OTHER).startsWith(acceptPrefix(ME))).toBe(true);
    expect(acceptScope(ME, OTHER).startsWith(acceptPrefix(OTHER))).toBe(false);
  });

  it("lee el id del pago pendiente", () => {
    expect(pendingAcceptId(op(JSON.stringify({ request_id: OTHER })))).toBe(OTHER);
    expect(pendingAcceptId(op(JSON.stringify({ request_id: "x" })))).toBeNull();
    expect(pendingAcceptId(op("no-json"))).toBeNull();
  });
});
