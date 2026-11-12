import { describe, expect, it } from "vitest";

import { canonicalJson } from "../../api/idempotency";
import {
  allBalanceAmount,
  isTransferRead,
  normalizeDescription,
  pendingTransfer,
  SUGGESTED_AMOUNTS,
  transferPayload,
  transferScope,
  validateRecipient,
} from "./transfer";

const OWN = "e8d24a91-9c3f-4e12-b7a4-6102f83c5d99";
const OTHER = "4f9b2d8e-17c3-4d62-a58f-90e8c71b3e21";

describe("utilidades de la transferencia", () => {
  it("sugeridos del diseño y ámbito por cuenta", () => {
    expect(SUGGESTED_AMOUNTS).toEqual([20_000, 50_000, 100_000]);
    expect(transferScope("cuenta-a")).toBe("cuenta-a:transfer");
  });

  it("el cuerpo omite la descripción vacía y normaliza el UUID", () => {
    expect(transferPayload(` ${OTHER.toUpperCase()} `, 1_000, null)).toEqual({ to_account_id: OTHER, amount: 1_000 });
    expect(transferPayload(OTHER, 1_000, "Pago")).toEqual({ to_account_id: OTHER, amount: 1_000, description: "Pago" });
  });

  it("«Todo el saldo» respeta el tope de 10.000.000 y nunca es negativo", () => {
    expect(allBalanceAmount(37_500)).toBe(37_500);
    expect(allBalanceAmount(12_000_000)).toBe(10_000_000);
    expect(allBalanceAmount(-5)).toBe(0);
  });

  it("valida el UUID y rechaza la propia cuenta sin importar mayúsculas", () => {
    expect(validateRecipient(OTHER, OWN)).toBeNull();
    expect(validateRecipient(OWN.toUpperCase(), OWN)).toBe("No puedes transferirte a tu propia cuenta.");
    expect(validateRecipient("abc", OWN)).toMatch(/36 caracteres/);
  });

  it("descripción: vacía es null, se recorta y admite 140 caracteres (contados como Python)", () => {
    expect(normalizeDescription("   ")).toEqual({ ok: true, value: null });
    expect(normalizeDescription("  Pago  ")).toEqual({ ok: true, value: "Pago" });
    expect(normalizeDescription("😀".repeat(140))).toEqual({ ok: true, value: "😀".repeat(140) });
    expect(normalizeDescription("a".repeat(141)).ok).toBe(false);
  });

  it("recupera los datos de una transferencia pendiente y tolera huellas corruptas", () => {
    const base = { scope: "x", key: "k", createdAt: "2026-11-12T00:00:00Z" };
    const payload = { to_account_id: OTHER, amount: 7_000, description: "Pago" };
    expect(pendingTransfer({ ...base, fingerprint: canonicalJson(payload) })).toEqual(payload);
    expect(pendingTransfer({ ...base, fingerprint: canonicalJson({ to_account_id: "x", amount: 1 }) })).toBeNull();
    expect(pendingTransfer({ ...base, fingerprint: "{roto" })).toBeNull();
  });

  it("reconoce la forma real de TransferRead", () => {
    const valid = {
      transaction_id: "eeeeeeee-0000-4000-8000-000000000001",
      to_account_id: OTHER,
      amount: 1_000,
      description: null,
      balance: 9_000,
      created_at: "2026-11-12T17:00:00+00:00",
    };
    expect(isTransferRead(valid)).toBe(true);
    expect(isTransferRead({ ...valid, to_account_id: "@usuario" })).toBe(false);
    expect(isTransferRead({ ok: true })).toBe(false);
  });
});
