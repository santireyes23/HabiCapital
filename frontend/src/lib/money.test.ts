import { describe, expect, it } from "vitest";

import { AMOUNT_ERROR_MESSAGES, formatCop, formatSignedCop, MAX_AMOUNT_COP, parseCopInput } from "./money";

describe("formato COP", () => {
  it.each([
    [0, "$0"],
    [1, "$1"],
    [1_000, "$1.000"],
    [42_500, "$42.500"],
    [2_450_000, "$2.450.000"],
    [10_000_000, "$10.000.000"],
    [-135_000, "-$135.000"],
  ])("%i -> %s", (amount, expected) => {
    expect(formatCop(amount)).toBe(expected);
  });

  it("con signo según el sentido del movimiento", () => {
    expect(formatSignedCop(500_000, "IN")).toBe("+$500.000");
    expect(formatSignedCop(135_000, "OUT")).toBe("-$135.000");
  });

  it("no acepta decimales ni valores no enteros", () => {
    for (const bad of [10.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => formatCop(bad)).toThrow();
    }
  });
});

describe("lectura del monto escrito", () => {
  it.each([
    ["150000", 150_000],
    ["150.000", 150_000],
    ["$ 150.000", 150_000],
    ["$1.000", 1_000],
    [" 1 ", 1],
    ["10.000.000", 10_000_000],
  ])("%s -> %i", (raw, value) => {
    expect(parseCopInput(raw)).toEqual({ ok: true, value });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["150000,50", "not_integer"],
    ["150.5", "not_integer"],
    ["1.50.000", "not_integer"],
    ["-5000", "not_integer"],
    ["1e5", "not_integer"],
    ["abc", "not_integer"],
    ["0", "too_small"],
    ["10000001", "too_large"],
    ["99999999999999999999", "too_large"],
  ])("%s -> error %s", (raw, error) => {
    expect(parseCopInput(raw)).toEqual({ ok: false, error });
  });

  it("el máximo coincide con el del backend (10.000.000)", () => {
    expect(MAX_AMOUNT_COP).toBe(10_000_000);
    expect(AMOUNT_ERROR_MESSAGES.too_large).toBe("El monto máximo es $10.000.000 COP.");
  });

  it("admite un tope propio (p. ej. el saldo disponible)", () => {
    expect(parseCopInput("2.000", { max: 1_500 })).toEqual({ ok: false, error: "too_large" });
  });
});
