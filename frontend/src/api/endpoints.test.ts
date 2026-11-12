import { describe, expect, it } from "vitest";

import { fakeFetch, jsonResponse } from "../test/http";
import { createApiClient } from "./client";
import { createEndpoints, isUuid } from "./endpoints";

const ID = "4f9b2d8e-17c3-4d62-a58f-90e8c71b3e21";
const KEY = "a1b2c3d4-0000-4000-8000-000000000001";

function setup() {
  const { fetchFn, requests } = fakeFetch(() => jsonResponse(200, {}));
  const api = createEndpoints(createApiClient({ getToken: () => "tok_123", fetchFn }));
  return { api, requests };
}

describe("endpoints reales del backend", () => {
  // [llamada, método, URL, autenticado, Idempotency-Key, cuerpo]
  const cases: [
    string,
    (api: ReturnType<typeof setup>["api"]) => Promise<unknown>,
    string,
    string,
    boolean,
    string | null,
    string | null,
  ][] = [
    ["health", (api) => api.health(), "GET", "/api/health", false, null, null],
    [
      "createAccount",
      (api) => api.createAccount({ owner_name: "Ana" }),
      "POST",
      "/api/accounts",
      false,
      null,
      '{"owner_name":"Ana"}',
    ],
    ["getMe", (api) => api.getMe(), "GET", "/api/accounts/me", true, null, null],
    ["rotateToken", (api) => api.rotateToken(), "POST", "/api/accounts/me/token", true, null, null],
    [
      "deposit",
      (api) => api.deposit({ amount: 50_000 }, KEY),
      "POST",
      "/api/accounts/me/deposits",
      true,
      KEY,
      '{"amount":50000}',
    ],
    [
      "transfer",
      (api) => api.transfer({ to_account_id: ID, amount: 1, description: "x" }, KEY),
      "POST",
      "/api/accounts/me/transfers",
      true,
      KEY,
      `{"to_account_id":"${ID}","amount":1,"description":"x"}`,
    ],
    [
      "listMovements",
      (api) => api.listMovements({ limit: 10, offset: 20, order: "desc" }),
      "GET",
      "/api/accounts/me/movements?limit=10&offset=20&order=desc",
      true,
      null,
      null,
    ],
    [
      "createMoneyRequest",
      (api) => api.createMoneyRequest({ payer_account_id: ID, amount: 42_500 }, KEY),
      "POST",
      "/api/money-requests",
      true,
      KEY,
      `{"payer_account_id":"${ID}","amount":42500}`,
    ],
    [
      "listMoneyRequests",
      (api) => api.listMoneyRequests({ role: "received", status: "PENDING", limit: 20 }),
      "GET",
      "/api/money-requests?role=received&status=PENDING&limit=20",
      true,
      null,
      null,
    ],
    ["getMoneyRequest", (api) => api.getMoneyRequest(ID), "GET", `/api/money-requests/${ID}`, true, null, null],
    [
      "rejectMoneyRequest",
      (api) => api.rejectMoneyRequest(ID),
      "POST",
      `/api/money-requests/${ID}/reject`,
      true,
      null,
      null,
    ],
    [
      "cancelMoneyRequest",
      (api) => api.cancelMoneyRequest(ID),
      "POST",
      `/api/money-requests/${ID}/cancel`,
      true,
      null,
      null,
    ],
    [
      "acceptMoneyRequest",
      (api) => api.acceptMoneyRequest(ID, KEY),
      "POST",
      `/api/money-requests/${ID}/accept`,
      true,
      KEY,
      null,
    ],
  ];

  it("cubre exactamente los 13 endpoints", () => {
    const { api } = setup();
    expect(Object.keys(api).sort()).toEqual(cases.map(([name]) => name).sort());
  });

  it.each(cases)("%s", async (_name, call, method, url, authenticated, key, body) => {
    const { api, requests } = setup();
    await call(api);
    const [request] = requests;
    expect(request?.method).toBe(method);
    expect(request?.url).toBe(url);
    expect(request?.headers.has("Authorization")).toBe(authenticated);
    expect(request?.headers.get("Idempotency-Key")).toBe(key);
    expect(request?.body).toBe(body);
  });

  it("rechaza ids que no son UUID antes de construir la ruta", () => {
    const { api, requests } = setup();
    for (const bad of ["../accounts/me", "abc", `${ID}?x=1`, `${ID}/accept`]) {
      expect(() => api.getMoneyRequest(bad)).toThrow("Identificador inválido");
    }
    expect(requests).toHaveLength(0);
  });

  it("reconoce UUID válidos", () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid(ID.toUpperCase())).toBe(true);
    expect(isUuid("4f9b2d8e17c34d62a58f90e8c71b3e21")).toBe(false);
  });
});
