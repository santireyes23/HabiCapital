/**
 * Pesos colombianos enteros. El backend solo acepta enteros (strict) entre 1 y 10.000.000 para
 * recargas y transferencias; el cliente valida lo mismo antes de enviar, sin decimales.
 * Formato del diseño: «$2.450.000» (punto de miles) y la etiqueta «COP» aparte.
 */

import { MAX_DEPOSIT_COP } from "../api/types";

export const MIN_AMOUNT_COP = 1;
export const MAX_AMOUNT_COP = MAX_DEPOSIT_COP;

// useGrouping "always": en español los números de 4 cifras no se agrupan por defecto (1000).
const integerFormat = new Intl.NumberFormat("es-CO", {
  maximumFractionDigits: 0,
  useGrouping: "always",
});

function assertInteger(amount: number): void {
  if (!Number.isSafeInteger(amount)) throw new Error("El monto debe ser un entero de pesos");
}

/** 2450000 -> "$2.450.000"; -135000 -> "-$135.000". */
export function formatCop(amount: number): string {
  assertInteger(amount);
  const digits = integerFormat.format(Math.abs(amount));
  return amount < 0 ? `-$${digits}` : `$${digits}`;
}

/** Con signo explícito según el sentido del movimiento: "+$500.000" o "-$135.000". */
export function formatSignedCop(amount: number, direction: "IN" | "OUT"): string {
  assertInteger(amount);
  const digits = formatCop(Math.abs(amount));
  return direction === "IN" ? `+${digits}` : `-${digits}`;
}

export type AmountParseError = "empty" | "not_integer" | "too_small" | "too_large";
export type AmountParseResult = { ok: true; value: number } | { ok: false; error: AmountParseError };

/**
 * Lee lo que escribe el usuario: "150000", "150.000" o "$ 150.000".
 * La coma es decimal en Colombia, así que cualquier coma o decimal se rechaza.
 */
export function parseCopInput(
  raw: string,
  { min = MIN_AMOUNT_COP, max = MAX_AMOUNT_COP }: { min?: number; max?: number } = {},
): AmountParseResult {
  const text = raw.replace(/^\s*\$\s*/, "").trim();
  if (text === "") return { ok: false, error: "empty" };

  let digits: string;
  if (/^\d+$/.test(text)) digits = text;
  else if (/^\d{1,3}(\.\d{3})+$/.test(text)) digits = text.replaceAll(".", "");
  else return { ok: false, error: "not_integer" };

  // Cifras de más (o ceros a la izquierda enormes) no caben en un entero seguro.
  const value = digits.length > 15 ? Number.POSITIVE_INFINITY : Number(digits);
  if (value < min) return { ok: false, error: "too_small" };
  if (value > max || !Number.isSafeInteger(value)) return { ok: false, error: "too_large" };
  return { ok: true, value };
}

export const AMOUNT_ERROR_MESSAGES: Record<AmountParseError, string> = {
  empty: "Ingresa un monto.",
  not_integer: "Ingresa pesos enteros, sin decimales.",
  too_small: `El monto mínimo es ${formatCop(MIN_AMOUNT_COP)} COP.`,
  too_large: `El monto máximo es ${formatCop(MAX_AMOUNT_COP)} COP.`,
};
