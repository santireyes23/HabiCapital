import { expect, test } from "@playwright/test";

import { balanceOf, createAccountApi, idempotencyKeys, login, loseNextResponse, type TestAccount } from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("Recargas, transferencias y movimientos (backend real, habicapital_test)", () => {
  let ana: TestAccount;
  let bruno: TestAccount;

  test.beforeAll(async ({ request }) => {
    ana = await createAccountApi(request, "Ana");
    bruno = await createAccountApi(request, "Bruno");
  });

  test("recargar saldo simulado", async ({ page, request }) => {
    await login(page, ana);
    await page.getByRole("link", { name: "Recargar saldo" }).first().click();
    await page.getByLabel(/Monto en pesos colombianos/).fill("100000");
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByRole("button", { name: "Confirmar recarga" }).click();
    await expect(page.getByRole("heading", { name: "Recarga completada" })).toBeVisible();
    expect(await balanceOf(request, ana)).toBe(100_000);
  });

  test("una recarga sin respuesta se reintenta con la misma clave y no duplica el dinero", async ({ page, request }) => {
    await login(page, ana);
    const keys = idempotencyKeys(page, "/accounts/me/deposits");
    await page.goto("/recargar");
    await page.getByLabel(/Monto en pesos colombianos/).fill("25000");
    await page.getByRole("button", { name: "Continuar" }).click();
    await loseNextResponse(page, "/accounts/me/deposits");
    await page.getByRole("button", { name: "Confirmar recarga" }).click();
    await expect(page.getByText(/No sabemos si la recarga se (aplicó|realizó)/)).toBeVisible();
    // El servidor sí la aplicó una vez.
    expect(await balanceOf(request, ana)).toBe(125_000);

    await page.getByRole("button", { name: "Reintentar con la misma clave" }).click();
    await expect(page.getByRole("heading", { name: "Esta recarga ya se había aplicado" })).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(await balanceOf(request, ana)).toBe(125_000);
  });

  test("transferir entre dos cuentas, también tras un corte de red, sin duplicar", async ({ page, request }) => {
    await login(page, ana);
    const keys = idempotencyKeys(page, "/accounts/me/transfers");
    await page.getByRole("link", { name: "Enviar dinero" }).first().click();
    await page.getByLabel(/UUID de la cuenta destino/).fill(bruno.id);
    await page.getByLabel(/Monto en pesos colombianos/).fill("30000");
    await page.getByLabel(/Descripción \/ motivo/).fill("Pago E2E");
    await page.getByRole("button", { name: "Revisar transferencia" }).click();
    await expect(page.getByText(bruno.id)).toBeVisible();
    await loseNextResponse(page, "/accounts/me/transfers");
    await page.getByRole("button", { name: "Confirmar transferencia" }).click();
    await expect(page.getByText("No sabemos si la transferencia se realizó")).toBeVisible();
    expect(await balanceOf(request, ana)).toBe(95_000);
    expect(await balanceOf(request, bruno)).toBe(30_000);

    await page.getByRole("button", { name: "Reintentar con la misma clave" }).click();
    await expect(page.getByRole("heading", { name: "Esta transferencia ya se había realizado" })).toBeVisible();
    expect(keys[1]).toBe(keys[0]);
    expect(await balanceOf(request, ana)).toBe(95_000);
    expect(await balanceOf(request, bruno)).toBe(30_000);
  });

  test("saldo insuficiente: el servidor lo rechaza y no se mueve dinero", async ({ page, request }) => {
    await login(page, bruno);
    await page.goto("/enviar");
    await page.getByLabel(/UUID de la cuenta destino/).fill(ana.id);
    await page.getByLabel(/Monto en pesos colombianos/).fill("40000");
    await page.getByRole("button", { name: "Revisar transferencia" }).click();
    await page.getByRole("button", { name: "Confirmar transferencia" }).click();
    await expect(page.getByText("Saldo insuficiente").first()).toBeVisible();
    expect(await balanceOf(request, bruno)).toBe(30_000);
    expect(await balanceOf(request, ana)).toBe(95_000);
  });

  test("movimientos de ambas cuentas con signo, contraparte y saldo", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, ana);
    await page.getByRole("link", { name: "Movimientos" }).first().click();
    const rows = page.getByRole("list", { name: "Movimientos" }).getByRole("listitem");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("-$30.000 COP");
    await expect(rows.nth(0)).toContainText(bruno.name);
    await expect(rows.nth(1)).toContainText("+$25.000 COP");
    await expect(rows.nth(2)).toContainText("+$100.000 COP");
    await context.close();

    const other = await browser.newContext();
    const brunoPage = await other.newPage();
    await login(brunoPage, bruno);
    await brunoPage.goto("/movimientos");
    const brunoRows = brunoPage.getByRole("list", { name: "Movimientos" }).getByRole("listitem");
    await expect(brunoRows).toHaveCount(1);
    await expect(brunoRows.first()).toContainText("+$30.000 COP");
    await expect(brunoRows.first()).toContainText(ana.name);
    await other.close();
  });
});
