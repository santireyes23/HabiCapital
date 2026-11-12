import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeFetch, jsonResponse } from "../test/http";
import { assertValidIdempotencyKey, buildUrl, createApiClient } from "./client";
import { ApiError, NETWORK_ERROR_MESSAGE, TIMEOUT_ERROR_MESSAGE } from "./errors";

const TOKEN = "tok_secreto-ABC123_xyz";

function clientWith(
  respond: Parameters<typeof fakeFetch>[0],
  options: { token?: string | null; onUnauthorized?: () => void; timeoutMs?: number } = {},
) {
  const { fetchFn, requests } = fakeFetch(respond);
  const client = createApiClient({
    getToken: () => (options.token === undefined ? TOKEN : options.token),
    fetchFn,
    ...(options.onUnauthorized === undefined ? {} : { onUnauthorized: options.onUnauthorized }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  return { client, requests };
}

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("se esperaba un ApiError");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("peticiones", () => {
  it("usa el prefijo /api del proxy y envía el token solo en Authorization", async () => {
    const { client, requests } = clientWith(() => jsonResponse(200, { ok: true }));

    await client.request("GET", "/accounts/me/movements", { query: { limit: 5, order: "asc" } });

    const [request] = requests;
    expect(request?.url).toBe("/api/accounts/me/movements?limit=5&order=asc");
    expect(request?.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(request?.url).not.toContain(TOKEN);
    expect(request?.headers.get("Idempotency-Key")).toBeNull();
  });

  it("no envía Authorization en los endpoints públicos", async () => {
    const { client, requests } = clientWith(() => jsonResponse(200, { status: "ok" }));

    await client.request("GET", "/health", { auth: false });

    expect(requests[0]?.headers.get("Authorization")).toBeNull();
  });

  it("envía el cuerpo como JSON y la Idempotency-Key indicada", async () => {
    const { client, requests } = clientWith(() => jsonResponse(201, { id: "x" }));

    await client.request("POST", "/accounts/me/deposits", {
      body: { amount: 50_000 },
      idempotencyKey: "4f9b2d8e-17c3-4d62-a58f-90e8c71b3e21",
    });

    const [request] = requests;
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("Content-Type")).toBe("application/json");
    expect(request?.headers.get("Idempotency-Key")).toBe("4f9b2d8e-17c3-4d62-a58f-90e8c71b3e21");
    expect(request?.body).toBe('{"amount":50000}');
  });

  it("omite los parámetros nulos o indefinidos", () => {
    expect(buildUrl("/api", "/money-requests", { role: "sent", status: null, limit: undefined })).toBe(
      "/api/money-requests?role=sent",
    );
  });

  it("rechaza rutas que no empiezan por /", () => {
    expect(() => buildUrl("/api", "accounts", {})).toThrow();
  });

  it("valida la Idempotency-Key con el patrón del backend", () => {
    expect(() => {
      assertValidIdempotencyKey("abc.DEF_1:2-3");
    }).not.toThrow();
    for (const bad of ["", "con espacio", "a/b", "x".repeat(101)]) {
      expect(() => {
        assertValidIdempotencyKey(bad);
      }).toThrow();
    }
  });

  it("indica si el servidor repitió una respuesta guardada (Idempotent-Replayed)", async () => {
    const { client } = clientWith(() =>
      jsonResponse(201, { balance: 10 }, { "Idempotent-Replayed": "true" }),
    );

    const response = await client.request("POST", "/accounts/me/deposits", {
      body: { amount: 10 },
      idempotencyKey: "k1",
    });

    expect(response).toEqual({ data: { balance: 10 }, status: 201, replayed: true });
  });

  it("una respuesta normal no se marca como repetida", async () => {
    const { client } = clientWith(() => jsonResponse(200, { id: 1 }));
    const response = await client.request("GET", "/accounts/me");
    expect(response.replayed).toBe(false);
  });
});

describe("errores", () => {
  it("convierte {detail: texto} en un error http con el mensaje del servidor", async () => {
    const { client } = clientWith(() => jsonResponse(409, { detail: "Saldo insuficiente" }));

    const error = await captureError(client.request("POST", "/accounts/me/transfers", { body: {} }));

    expect(error.kind).toBe("http");
    expect(error.status).toBe(409);
    expect(error.message).toBe("Saldo insuficiente");
    expect(error.outcomeUncertain).toBe(false);
  });

  it("convierte el 422 de validación de FastAPI en errores por campo", async () => {
    const { client } = clientWith(() =>
      jsonResponse(422, {
        detail: [
          { type: "greater_than", loc: ["body", "amount"], msg: "Input should be greater than 0" },
          { type: "missing", loc: ["header", "Idempotency-Key"], msg: "Field required" },
        ],
      }),
    );

    const error = await captureError(client.request("POST", "/accounts/me/deposits", { body: {} }));

    expect(error.kind).toBe("validation");
    expect(error.status).toBe(422);
    expect(error.fieldErrors).toEqual([
      { location: "body", field: "amount", message: "Input should be greater than 0" },
      { location: "header", field: "Idempotency-Key", message: "Field required" },
    ]);
  });

  it("un 422 de negocio con texto sigue siendo un error http (p. ej. clave reutilizada)", async () => {
    const { client } = clientWith(() =>
      jsonResponse(422, { detail: "La Idempotency-Key ya se usó con una solicitud distinta" }),
    );
    const error = await captureError(client.request("POST", "/money-requests", { body: {} }));
    expect(error.kind).toBe("http");
    expect(error.message).toBe("La Idempotency-Key ya se usó con una solicitud distinta");
  });

  it("un error sin cuerpo JSON recibe un mensaje genérico", async () => {
    const { client } = clientWith(() => new Response("Internal Server Error", { status: 500 }));
    const error = await captureError(client.request("GET", "/accounts/me"));
    expect(error.kind).toBe("http");
    expect(error.status).toBe(500);
    expect(error.outcomeUncertain).toBe(true);
  });

  it("sin respuesta es un error de red con resultado incierto", async () => {
    const { client } = clientWith(() => {
      throw new TypeError("Failed to fetch");
    });
    const error = await captureError(client.request("GET", "/accounts/me"));
    expect(error.kind).toBe("network");
    expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
    expect(error.status).toBeNull();
    expect(error.outcomeUncertain).toBe(true);
  });

  it("corta la petición al agotar el tiempo y la marca como incierta", async () => {
    vi.useFakeTimers();
    const { client } = clientWith(
      (request) =>
        // Servidor que nunca responde; como el fetch real, rechaza al abortarse la señal.
        new Promise<Response>((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      { timeoutMs: 1_000 },
    );
    const pending = captureError(client.request("POST", "/accounts/me/transfers", { body: {} }));
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await pending;
    expect(error.kind).toBe("timeout");
    expect(error.message).toBe(TIMEOUT_ERROR_MESSAGE);
    expect(error.outcomeUncertain).toBe(true);
  });

  it("una respuesta 2xx que no es JSON es inválida e incierta", async () => {
    const { client } = clientWith(() => new Response("<html>", { status: 200 }));
    const error = await captureError(client.request("GET", "/accounts/me"));
    expect(error.kind).toBe("invalid_response");
    expect(error.outcomeUncertain).toBe(true);
  });

  it("la cancelación pedida por quien llama se propaga sin convertirse en error de red", async () => {
    const controller = new AbortController();
    const { client } = clientWith(() => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await expect(
      client.request("GET", "/accounts/me", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("ningún error contiene el token", async () => {
    const responses = [
      () => jsonResponse(401, { detail: "Token ausente o inválido" }),
      () => jsonResponse(422, { detail: [{ loc: ["body", "x"], msg: "bad" }] }),
      () => jsonResponse(500, {}),
      () => {
        throw new TypeError(`fallo con ${TOKEN}`);
      },
    ];
    for (const respond of responses) {
      const { client } = clientWith(respond);
      const error = await captureError(client.request("GET", "/accounts/me"));
      const visible = JSON.stringify({
        kind: error.kind,
        status: error.status,
        message: error.message,
        fieldErrors: error.fieldErrors,
        stack: error.stack,
      });
      expect(visible).not.toContain(TOKEN);
    }
  });
});

describe("autenticación", () => {
  it("un 401 en una petición autenticada avisa para cerrar la sesión", async () => {
    const onUnauthorized = vi.fn();
    const { client } = clientWith(() => jsonResponse(401, { detail: "Token ausente o inválido" }), {
      onUnauthorized,
    });

    const error = await captureError(client.request("GET", "/accounts/me"));

    expect(error.isUnauthorized).toBe(true);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("un 401 en un endpoint público no cierra la sesión", async () => {
    const onUnauthorized = vi.fn();
    const { client } = clientWith(() => jsonResponse(401, { detail: "x" }), { onUnauthorized });
    await captureError(client.request("GET", "/health", { auth: false }));
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("sin token no llama al servidor y responde como 401", async () => {
    const onUnauthorized = vi.fn();
    const { client, requests } = clientWith(() => jsonResponse(200, {}), {
      token: null,
      onUnauthorized,
    });

    const error = await captureError(client.request("GET", "/accounts/me"));

    expect(requests).toHaveLength(0);
    expect(error.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});
