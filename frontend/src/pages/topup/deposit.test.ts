import { describe, expect, it } from "vitest";

import { canonicalJson } from "../../api/idempotency";
import { depositPayload, depositScope, isDepositRead, pendingAmount, QUICK_AMOUNTS } from "./deposit";

const VALID = {
  transaction_id: "dddddddd-0000-4000-8000-000000000001",
  amount: 100_000,
  description: null,
  balance: 105_000,
  created_at: "2026-11-12T16:00:00+00:00",
};

describe("utilidades de la recarga", () => {
  it("los montos rápidos son los del diseño", () => {
    expect(QUICK_AMOUNTS).toEqual([50_000, 100_000, 250_000, 500_000]);
  });

  it("el cuerpo es solo el monto (sin descripción) y el ámbito es por cuenta", () => {
    expect(depositPayload(1_000)).toEqual({ amount: 1_000 });
    expect(depositScope("cuenta-a")).toBe("cuenta-a:deposit");
  });

  it("lee el monto de una operación pendiente y tolera datos corruptos", () => {
    const base = { scope: "x", key: "k", createdAt: "2026-11-12T00:00:00Z" };
    expect(pendingAmount({ ...base, fingerprint: canonicalJson({ amount: 7_000 }) })).toBe(7_000);
    expect(pendingAmount({ ...base, fingerprint: "{roto" })).toBeNull();
    expect(pendingAmount({ ...base, fingerprint: '{"amount":-1}' })).toBeNull();
  });

  it("reconoce la forma real de DepositRead y rechaza respuestas inesperadas", () => {
    expect(isDepositRead(VALID)).toBe(true);
    expect(isDepositRead({ ...VALID, description: "Recarga" })).toBe(true);
    expect(isDepositRead({ ...VALID, balance: 1.5 })).toBe(false);
    expect(isDepositRead({ ...VALID, transaction_id: "tx_1" })).toBe(false);
    expect(isDepositRead({ ok: true })).toBe(false);
  });
});
