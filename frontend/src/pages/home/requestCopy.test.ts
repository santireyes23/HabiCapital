import { describe, expect, it } from "vitest";

import type { MoneyRequestStatus } from "../../api/types";
import { moneyRequest } from "../../test/fixtures";
import { describeRequest, mergeRecent, roleOf } from "./requestCopy";

const ME = { account_id: "e8d24a91-9c3f-4e12-b7a4-6102f83c5d99", owner_name: "Camilo" };
const ANA = { account_id: "4f9b2d8e-17c3-4d62-a58f-90e8c71b3e21", owner_name: "Ana" };

describe("textos de una solicitud según el papel", () => {
  it.each<[MoneyRequestStatus, "received" | "sent", string, string, string]>([
    ["PENDING", "received", "Monto solicitado", "", "Pendiente de tu respuesta en Solicitudes"],
    ["PENDING", "sent", "Monto solicitado", "", "Esperando la respuesta de Ana"],
    ["ACCEPTED", "received", "Monto pagado", "-", "Pagaste esta solicitud desde tu saldo"],
    ["ACCEPTED", "sent", "Monto acreditado", "+", "Acreditado a tu saldo"],
    ["REJECTED", "received", "Monto declinado", "", "Rechazaste esta solicitud"],
    ["REJECTED", "sent", "Monto declinado", "", "Ana rechazó tu solicitud"],
    ["CANCELLED", "received", "Monto anulado", "", "Ana la canceló antes de que respondieras"],
    ["CANCELLED", "sent", "Monto anulado", "", "Cancelaste esta solicitud"],
  ])("%s · %s", (status, role, label, sign, footer) => {
    const request =
      role === "received"
        ? moneyRequest(ANA, ME, 1_000, status, "2026-11-12T10:00:00Z")
        : moneyRequest(ME, ANA, 1_000, status, "2026-11-12T10:00:00Z");
    const copy = describeRequest(request, ME.account_id);
    expect(roleOf(request, ME.account_id)).toBe(role);
    expect(copy.counterparty).toEqual(ANA);
    expect(copy.amountLabel).toBe(label);
    expect(copy.amountSign).toBe(sign);
    expect(copy.footer).toBe(footer);
  });

  it("usa la fecha de creación si está pendiente y la de resolución si ya terminó", () => {
    const pending = moneyRequest(ANA, ME, 1, "PENDING", "2026-11-12T10:00:00Z");
    const done = moneyRequest(ANA, ME, 1, "REJECTED", "2026-11-12T10:00:00Z");
    expect(describeRequest(pending, ME.account_id).date).toBe(pending.created_at);
    expect(describeRequest(done, ME.account_id).date).toBe(done.resolved_at);
  });

  it("mergeRecent mezcla por fecha descendente y respeta el límite", () => {
    const a = moneyRequest(ANA, ME, 1, "PENDING", "2026-11-12T10:00:00Z");
    const b = moneyRequest(ME, ANA, 2, "PENDING", "2026-11-12T12:00:00Z");
    const c = moneyRequest(ANA, ME, 3, "PENDING", "2026-11-11T12:00:00Z");
    expect(mergeRecent([a, c], [b], 2).map((r) => r.amount)).toEqual([2, 1]);
  });
});
