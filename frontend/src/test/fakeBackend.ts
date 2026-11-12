/**
 * Backend falso SOLO PARA PRUEBAS: imita las respuestas reales de FastAPI (mismos status, formas
 * y formatos de error) para /health, cuentas, token, movimientos y solicitudes. La aplicación
 * nunca lo usa: en producción todo pasa por el proxy hacia el backend real.
 */

import type { AccountRead, MoneyRequestRead, MovementRead } from "../api/types";
import { fakeFetch, jsonResponse, type RecordedRequest } from "./http";

const UNAUTHORIZED = { detail: "Token ausente o inválido" };

type Responder = (request: RecordedRequest) => Response | Promise<Response>;

function page<T>(items: T[], url: URL, sortKey: (item: T) => string) {
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";
  const sorted = [...items].sort((a, b) =>
    order === "desc" ? sortKey(b).localeCompare(sortKey(a)) : sortKey(a).localeCompare(sortKey(b)),
  );
  return { items: sorted.slice(offset, offset + limit), total: items.length, limit, offset, order };
}

export function fakeBackend() {
  const accounts = new Map<string, AccountRead>();
  const movements = new Map<string, MovementRead[]>();
  const moneyRequests: MoneyRequestRead[] = [];
  const overrides: Responder[] = [];
  const routeOverrides: { method: string; path: string; responder: Responder }[] = [];
  let created = 0;
  let rotations = 0;
  let transactions = 0;
  let requestsCreated = 0;
  /** Registros de idempotencia por cuenta y clave, como idempotency_records del backend. */
  const idempotency = new Map<string, { body: string; response: unknown; status: number }>();

  function addAccount(token: string, ownerName: string, balance = 0): AccountRead {
    created += 1;
    const account: AccountRead = {
      id: `00000000-0000-4000-8000-${String(created).padStart(12, "0")}`,
      owner_name: ownerName,
      balance,
      created_at: "2026-11-12T15:00:00+00:00",
    };
    accounts.set(token, account);
    return account;
  }

  function addMovement(accountId: string, movement: MovementRead) {
    movements.set(accountId, [...(movements.get(accountId) ?? []), movement]);
  }

  function addMoneyRequest(request: MoneyRequestRead) {
    moneyRequests.push(request);
  }

  /**
   * Como run_idempotent del backend: valida el header, repite la respuesta guardada (con
   * Idempotent-Replayed) y solo guarda las respuestas de éxito; los errores no consumen la clave.
   */
  function idempotent(
    accountId: string,
    request: RecordedRequest,
    operation: () => { status: number; body: unknown; store?: boolean },
  ): Response {
    const key = request.headers.get("Idempotency-Key");
    if (key === null || !/^[A-Za-z0-9._:-]{1,100}$/.test(key)) {
      return jsonResponse(422, {
        detail: [{ type: "missing", loc: ["header", "Idempotency-Key"], msg: "Field required" }],
      });
    }
    const body = `${new URL(request.url, "http://x").pathname}|${request.body ?? ""}`;
    const recordKey = `${accountId}|${key}`;
    const stored = idempotency.get(recordKey);
    if (stored !== undefined) {
      if (stored.body !== body) {
        return jsonResponse(422, { detail: "La Idempotency-Key ya se usó con una solicitud distinta" });
      }
      return jsonResponse(stored.status, stored.response, { "Idempotent-Replayed": "true" });
    }
    const result = operation();
    if (result.store === true) {
      idempotency.set(recordKey, { body, response: structuredClone(result.body), status: result.status });
    }
    return jsonResponse(result.status, result.body);
  }

  function route(request: RecordedRequest): Response {
    const url = new URL(request.url, "http://127.0.0.1:5173");
    const path = url.pathname.replace(/^\/api/, "");
    const auth = request.headers.get("Authorization");
    const token = auth?.startsWith("Bearer ") === true ? auth.slice(7) : null;
    const me = token === null ? undefined : accounts.get(token);
    const unauthorized = () => jsonResponse(401, UNAUTHORIZED, { "WWW-Authenticate": "Bearer" });

    if (request.method === "GET" && path === "/health") return jsonResponse(200, { status: "ok" });

    if (request.method === "POST" && path === "/accounts") {
      const body = JSON.parse(request.body ?? "{}") as { owner_name?: unknown };
      const name = typeof body.owner_name === "string" ? body.owner_name.trim() : "";
      if (name.length === 0 || Array.from(name).length > 100) {
        return jsonResponse(422, {
          detail: [{ type: "string_too_short", loc: ["body", "owner_name"], msg: "invalid" }],
        });
      }
      const newToken = `tok${String(created + 1).padStart(3, "0")}_Zx9abcDEF123ghiJKL456mnoPQR789s`;
      const account = addAccount(newToken, name);
      return jsonResponse(201, { ...account, token: newToken }, { "Cache-Control": "no-store" });
    }

    if (me === undefined || token === null) return unauthorized();

    if (request.method === "GET" && path === "/accounts/me") return jsonResponse(200, me);

    if (request.method === "POST" && path === "/accounts/me/token") {
      rotations += 1;
      const newToken = `rot${String(rotations).padStart(3, "0")}_Qw7ertyUIOP456asdfGHJ789zxcvBN`;
      accounts.delete(token);
      accounts.set(newToken, me);
      return jsonResponse(200, { token: newToken }, { "Cache-Control": "no-store" });
    }

    if (request.method === "POST" && path === "/accounts/me/deposits") {
      const key = request.headers.get("Idempotency-Key");
      if (key === null || !/^[A-Za-z0-9._:-]{1,100}$/.test(key)) {
        return jsonResponse(422, {
          detail: [{ type: "missing", loc: ["header", "Idempotency-Key"], msg: "Field required" }],
        });
      }
      const body = request.body ?? "";
      const recordKey = `${me.id}|${key}`;
      const stored = idempotency.get(recordKey);
      if (stored !== undefined) {
        if (stored.body !== body) {
          return jsonResponse(422, { detail: "La Idempotency-Key ya se usó con una solicitud distinta" });
        }
        return jsonResponse(stored.status, stored.response, { "Idempotent-Replayed": "true" });
      }
      const parsed = JSON.parse(body || "{}") as { amount?: unknown; description?: unknown };
      const amount = parsed.amount;
      if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0 || amount > 10_000_000) {
        return jsonResponse(422, {
          detail: [{ type: "less_than_equal", loc: ["body", "amount"], msg: "Input should be valid" }],
        });
      }
      transactions += 1;
      me.balance += amount;
      const createdAt = `2026-11-12T16:${String(transactions).padStart(2, "0")}:00+00:00`;
      const response = {
        transaction_id: `dddddddd-0000-4000-8000-${String(transactions).padStart(12, "0")}`,
        amount,
        description: typeof parsed.description === "string" ? parsed.description : null,
        balance: me.balance,
        created_at: createdAt,
      };
      addMovement(me.id, {
        transaction_id: response.transaction_id,
        type: "DEPOSIT",
        direction: "IN",
        amount,
        balance_after: me.balance,
        description: response.description,
        counterparty: null,
        created_at: createdAt,
      });
      idempotency.set(recordKey, { body, response, status: 201 });
      return jsonResponse(201, response);
    }

    if (request.method === "POST" && path === "/accounts/me/transfers") {
      const key = request.headers.get("Idempotency-Key");
      if (key === null || !/^[A-Za-z0-9._:-]{1,100}$/.test(key)) {
        return jsonResponse(422, {
          detail: [{ type: "missing", loc: ["header", "Idempotency-Key"], msg: "Field required" }],
        });
      }
      const body = request.body ?? "";
      const recordKey = `${me.id}|${key}`;
      const stored = idempotency.get(recordKey);
      if (stored !== undefined) {
        if (stored.body !== body) {
          return jsonResponse(422, { detail: "La Idempotency-Key ya se usó con una solicitud distinta" });
        }
        return jsonResponse(stored.status, stored.response, { "Idempotent-Replayed": "true" });
      }
      const parsed = JSON.parse(body || "{}") as { to_account_id?: unknown; amount?: unknown; description?: unknown };
      const { to_account_id: to, amount } = parsed;
      const description = typeof parsed.description === "string" ? parsed.description.trim() : null;
      if (
        typeof to !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(to) ||
        typeof amount !== "number" ||
        !Number.isInteger(amount) ||
        amount <= 0 ||
        amount > 10_000_000 ||
        (description !== null && (description.length === 0 || Array.from(description).length > 140))
      ) {
        return jsonResponse(422, { detail: [{ type: "value_error", loc: ["body", "amount"], msg: "invalid" }] });
      }
      // Mismo orden que ledger/service.transfer: propia cuenta, destino, saldo.
      if (to.toLowerCase() === me.id) return jsonResponse(422, { detail: "No puedes transferirte a tu propia cuenta" });
      const destination = [...accounts.values()].find((account) => account.id === to.toLowerCase());
      if (destination === undefined) return jsonResponse(404, { detail: "Cuenta de destino no encontrada" });
      if (me.balance < amount) return jsonResponse(409, { detail: "Saldo insuficiente" });
      transactions += 1;
      me.balance -= amount;
      destination.balance += amount;
      const createdAt = `2026-11-12T17:${String(transactions).padStart(2, "0")}:00+00:00`;
      const transactionId = `eeeeeeee-0000-4000-8000-${String(transactions).padStart(12, "0")}`;
      const response = {
        transaction_id: transactionId,
        to_account_id: destination.id,
        amount,
        description,
        balance: me.balance,
        created_at: createdAt,
      };
      addMovement(me.id, {
        transaction_id: transactionId,
        type: "TRANSFER_SENT",
        direction: "OUT",
        amount,
        balance_after: me.balance,
        description,
        counterparty: { account_id: destination.id, owner_name: destination.owner_name },
        created_at: createdAt,
      });
      addMovement(destination.id, {
        transaction_id: transactionId,
        type: "TRANSFER_RECEIVED",
        direction: "IN",
        amount,
        balance_after: destination.balance,
        description,
        counterparty: { account_id: me.id, owner_name: me.owner_name },
        created_at: createdAt,
      });
      idempotency.set(recordKey, { body, response, status: 201 });
      return jsonResponse(201, response);
    }

    if (request.method === "GET" && path === "/accounts/me/movements") {
      return jsonResponse(200, page(movements.get(me.id) ?? [], url, (m) => m.created_at));
    }

    if (request.method === "GET" && path === "/money-requests") {
      const role = url.searchParams.get("role");
      if (role !== "sent" && role !== "received") {
        return jsonResponse(422, { detail: [{ type: "missing", loc: ["query", "role"], msg: "Field required" }] });
      }
      const status = url.searchParams.get("status");
      const mine = moneyRequests.filter(
        (r) =>
          (role === "sent" ? r.requester.account_id : r.payer.account_id) === me.id &&
          (status === null || r.status === status),
      );
      return jsonResponse(200, {
        ...page(mine, url, (r) => `${r.created_at}|${r.id}`),
        role,
        status,
      });
    }

    if (request.method === "POST" && path === "/money-requests") {
      return idempotent(me.id, request, () => {
        const parsed = JSON.parse(request.body ?? "{}") as {
          payer_account_id?: unknown;
          amount?: unknown;
          description?: unknown;
        };
        const { payer_account_id: payerId, amount } = parsed;
        const description = typeof parsed.description === "string" ? parsed.description.trim() : null;
        if (
          typeof payerId !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(payerId) ||
          typeof amount !== "number" ||
          !Number.isInteger(amount) ||
          amount <= 0 ||
          amount > 10_000_000 ||
          (description !== null && (description.length === 0 || Array.from(description).length > 140))
        ) {
          return { status: 422, body: { detail: [{ type: "value_error", loc: ["body", "amount"], msg: "invalid" }] } };
        }
        // Mismo orden que money_requests/service.create_money_request: propia cuenta, pagador.
        if (payerId.toLowerCase() === me.id) return { status: 422, body: { detail: "No puedes solicitarte dinero a ti mismo" } };
        const payer = [...accounts.values()].find((account) => account.id === payerId.toLowerCase());
        if (payer === undefined) return { status: 404, body: { detail: "Cuenta destinataria no encontrada" } };
        requestsCreated += 1;
        const created: MoneyRequestRead = {
          id: `ffffffff-0000-4000-8000-${String(requestsCreated).padStart(12, "0")}`,
          requester: { account_id: me.id, owner_name: me.owner_name },
          payer: { account_id: payer.id, owner_name: payer.owner_name },
          amount,
          description,
          status: "PENDING",
          transaction_id: null,
          created_at: `2026-11-12T18:${String(requestsCreated).padStart(2, "0")}:00+00:00`,
          resolved_at: null,
        };
        moneyRequests.push(created);
        return { status: 201, body: created, store: true };
      });
    }

    const single = /^\/money-requests\/([0-9a-f-]{36})(?:\/(accept|reject|cancel))?$/.exec(path);
    if (single !== null) {
      const [, id, action] = single;
      const found = moneyRequests.find((item) => item.id === id);
      const participates = found !== undefined && (found.payer.account_id === me.id || found.requester.account_id === me.id);
      const notFound = () => jsonResponse(404, { detail: "Solicitud no encontrada" });

      if (request.method === "GET" && action === undefined) {
        return found !== undefined && participates ? jsonResponse(200, found) : notFound();
      }
      if (request.method !== "POST" || action === undefined) return jsonResponse(405, { detail: "Method Not Allowed" });

      // Sin permiso responde lo mismo que si no existiera (404), como _lock_request.
      const allowed =
        found !== undefined &&
        (action === "cancel" ? found.requester.account_id === me.id : found.payer.account_id === me.id);
      if (found === undefined || !allowed) return notFound();

      if (action === "accept") {
        return idempotent(me.id, request, () => {
          if (found.status !== "PENDING") return { status: 409, body: { detail: "La solicitud ya no está pendiente" } };
          const requester = [...accounts.values()].find((account) => account.id === found.requester.account_id);
          if (requester === undefined) return { status: 404, body: { detail: "Solicitud no encontrada" } };
          if (me.balance < found.amount) return { status: 409, body: { detail: "Saldo insuficiente" } };
          transactions += 1;
          me.balance -= found.amount;
          requester.balance += found.amount;
          const createdAt = `2026-11-12T19:${String(transactions).padStart(2, "0")}:00+00:00`;
          const transactionId = `abababab-0000-4000-8000-${String(transactions).padStart(12, "0")}`;
          found.status = "ACCEPTED";
          found.transaction_id = transactionId;
          found.resolved_at = createdAt;
          addMovement(me.id, {
            transaction_id: transactionId,
            type: "TRANSFER_SENT",
            direction: "OUT",
            amount: found.amount,
            balance_after: me.balance,
            description: found.description,
            counterparty: { account_id: requester.id, owner_name: requester.owner_name },
            created_at: createdAt,
          });
          addMovement(requester.id, {
            transaction_id: transactionId,
            type: "TRANSFER_RECEIVED",
            direction: "IN",
            amount: found.amount,
            balance_after: requester.balance,
            description: found.description,
            counterparty: { account_id: me.id, owner_name: me.owner_name },
            created_at: createdAt,
          });
          return { status: 200, body: { ...found, balance: me.balance }, store: true };
        });
      }

      if (found.status !== "PENDING") return jsonResponse(409, { detail: "La solicitud ya no está pendiente" });
      found.status = action === "reject" ? "REJECTED" : "CANCELLED";
      found.resolved_at = "2026-11-12T20:00:00+00:00";
      return jsonResponse(200, found);
    }

    return jsonResponse(404, { detail: "Not Found" });
  }

  const { fetchFn, requests } = fakeFetch((request) => {
    const path = new URL(request.url, "http://x").pathname.replace(/^\/api/, "");
    const index = routeOverrides.findIndex((o) => o.method === request.method && o.path === path);
    if (index !== -1) {
      const [match] = routeOverrides.splice(index, 1);
      if (match !== undefined) return match.responder(request);
    }
    const override = overrides.shift();
    return override === undefined ? route(request) : override(request);
  });

  return {
    fetchFn,
    requests,
    accounts,
    addAccount,
    addMovement,
    addMoneyRequest,
    moneyRequests,
    /** La próxima petición la responde `responder` (p. ej. un fallo de red). */
    next(responder: Responder) {
      overrides.push(responder);
    },
    /** La próxima petición a `path` (y método) la responde `responder`; las demás siguen normales. */
    nextFor(method: string, path: string, responder: Responder) {
      routeOverrides.push({ method, path, responder });
    },
    /** Peticiones que no son el chequeo de salud de Inicio. */
    apiRequests() {
      return requests.filter((request) => !request.url.endsWith("/health"));
    },
    /** Peticiones a una ruta concreta (sin /api ni parámetros). */
    requestsTo(path: string, method?: string) {
      return requests.filter(
        (request) =>
          new URL(request.url, "http://x").pathname === `/api${path}` &&
          (method === undefined || request.method === method),
      );
    },
  };
}

export type FakeBackend = ReturnType<typeof fakeBackend>;

/** Un fetch que nunca llega al servidor (como el navegador sin red). */
export const networkDown: Responder = () => {
  throw new TypeError("Failed to fetch");
};

/** Respuesta retenida hasta que la prueba la libere (para probar dobles envíos). */
export function deferred() {
  let release: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { responder: (() => promise) as Responder, release };
}
