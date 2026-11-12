import { expect, test } from "@playwright/test";

import { balanceOf, login, uniqueName, type TestAccount } from "./helpers";

test.describe("Cuenta y sesión (backend real, habicapital_test)", () => {
  test("crear cuenta, guardar el token, cerrar sesión y volver a entrar con él", async ({ page, request }) => {
    const name = uniqueName("Titular");
    await page.goto("/acceso");
    await page.getByLabel(/nombre completo del titular/i).fill(name);
    await page.getByRole("button", { name: "Crear mi cuenta" }).click();

    const tokenField = page.getByText("Bearer token de acceso", { exact: true }).locator("xpath=../..");
    const token = (await tokenField.locator("span.font-mono").textContent())?.trim() ?? "";
    const idField = page.getByText("UUID de tu cuenta", { exact: true }).locator("xpath=../..");
    const id = (await idField.locator("span.font-mono").textContent())?.trim() ?? "";
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(token.length).toBeGreaterThan(20);
    const account: TestAccount = { id, name, token };

    // El token no se guarda en localStorage ni aparece en la URL.
    expect(await page.evaluate(() => JSON.stringify(window.localStorage))).not.toContain(token);
    expect(page.url()).not.toContain(token);

    const proceed = page.getByRole("button", { name: "Continuar a mi panel" });
    await expect(proceed).toBeDisabled();
    await page.getByLabel("Ya guardé mi token en un lugar seguro.").check();
    await proceed.click();
    await page.waitForURL((url) => url.pathname === "/");
    await expect(page.getByRole("heading", { name: "Tu dinero, en movimiento." })).toBeVisible();
    await expect(page.getByText(name).first()).toBeVisible();
    expect(await balanceOf(request, account)).toBe(0);

    await page.getByRole("button", { name: "Cerrar sesión" }).first().click();
    await expect(page.getByText(/Cerraste sesión/)).toBeVisible();
    expect(await page.evaluate(() => JSON.stringify(window.sessionStorage))).not.toContain(token);
    await expect(page.getByText(name)).toHaveCount(0);

    await login(page, account);
    await expect(page.getByText(name).first()).toBeVisible();
  });

  test("un token inválido no da acceso y las rutas privadas llevan a /acceso", async ({ page }) => {
    await page.goto("/movimientos");
    await expect(page).toHaveURL(/\/acceso$/);
    await page.getByRole("tab", { name: "Ya tengo cuenta" }).click();
    await page.getByLabel(/bearer token de acceso/i).fill("token-que-no-existe-en-habicapital-test-123456");
    await page.getByRole("button", { name: "Acceder a mi cuenta" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/acceso(\?modo=ingresar)?$/);
    expect(await page.evaluate(() => window.sessionStorage.getItem("habicapital.session.token"))).toBeNull();
  });
});
