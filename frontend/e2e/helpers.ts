/**
 * Utilidades E2E. Todas las cuentas se crean en habicapital_test (ver e2e/backend.py) y sus
 * tokens solo viven en memoria durante la prueba: nunca se imprimen ni se guardan en archivos.
 */

import { expect, type APIRequestContext, type Browser, type Page, type Route } from "@playwright/test";

export interface TestAccount {
  id: string;
  name: string;
  token: string;
}

let counter = 0;
/** Nombre único por ejecución, para no confundir cuentas de ejecuciones anteriores. */
export function uniqueName(base: string): string {
  counter += 1;
  return `${base} E2E ${Date.now().toString(36)}${String(counter)}`;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Cuenta creada por la API real (para preparar contrapartes rápidamente). */
export async function createAccountApi(request: APIRequestContext, base: string): Promise<TestAccount> {
  const name = uniqueName(base);
  const response = await request.post("/api/accounts", { data: { owner_name: name } });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id: string; token: string };
  return { id: body.id, name, token: body.token };
}

export async function balanceOf(request: APIRequestContext, account: TestAccount): Promise<number> {
  const response = await request.get("/api/accounts/me", { headers: bearer(account.token) });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { balance: number }).balance;
}

export async function depositApi(request: APIRequestContext, account: TestAccount, amount: number): Promise<void> {
  const response = await request.post("/api/accounts/me/deposits", {
    headers: { ...bearer(account.token), "Idempotency-Key": crypto.randomUUID() },
    data: { amount },
  });
  expect(response.status()).toBe(201);
}

export async function requestMoneyApi(
  request: APIRequestContext,
  requester: TestAccount,
  payer: TestAccount,
  amount: number,
  description: string,
): Promise<string> {
  const response = await request.post("/api/money-requests", {
    headers: { ...bearer(requester.token), "Idempotency-Key": crypto.randomUUID() },
    data: { payer_account_id: payer.id, amount, description },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

export async function requestStatus(request: APIRequestContext, account: TestAccount, id: string): Promise<string> {
  const response = await request.get(`/api/money-requests/${id}`, { headers: bearer(account.token) });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { status: string }).status;
}

/** Entra con «Ya tengo cuenta» y espera a Inicio. */
export async function login(page: Page, account: TestAccount): Promise<void> {
  await page.goto("/acceso");
  await page.getByRole("tab", { name: "Ya tengo cuenta" }).click();
  await page.getByLabel(/bearer token de acceso/i).fill(account.token);
  await page.getByRole("button", { name: "Acceder a mi cuenta" }).click();
  // /acceso e Inicio comparten el título: se espera a salir de /acceso (sesión ya guardada).
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("heading", { name: "Tu dinero, en movimiento." })).toBeVisible();
}

/** Una pestaña nueva y aislada (sin sessionStorage compartido) con la sesión de `account`. */
export async function sessionPage(browser: Browser, account: TestAccount): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, account);
  return page;
}

/**
 * La próxima petición a `urlPart` llega al servidor (se procesa de verdad) pero el navegador no
 * recibe la respuesta: simula un corte de red justo después de enviar.
 */
export async function loseNextResponse(page: Page, urlPart: string): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith(urlPart),
    async (route: Route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fetch();
      await route.abort("internetdisconnected");
    },
    { times: 1 },
  );
}

export function idempotencyKeys(page: Page, urlPart: string): string[] {
  const keys: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith(urlPart)) {
      const key = request.headers()["idempotency-key"];
      if (key !== undefined) keys.push(key);
    }
  });
  return keys;
}
