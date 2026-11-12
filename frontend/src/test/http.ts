/** Utilidades de prueba: un fetch falso que registra las peticiones. Solo para tests. */

import { vi } from "vitest";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
  signal: AbortSignal | null;
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** fetch falso: cada llamada devuelve (o lanza) lo que indique `respond`. */
export function fakeFetch(respond: (request: RecordedRequest) => Response | Promise<Response>) {
  const requests: RecordedRequest[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request: RecordedRequest = {
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
      signal: init?.signal ?? null,
    };
    requests.push(request);
    return respond(request);
  });
  return { fetchFn: fn as unknown as typeof fetch, requests };
}
