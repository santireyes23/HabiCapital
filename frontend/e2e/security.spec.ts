import { expect, test } from "@playwright/test";

import { createAccountApi, depositApi, login } from "./helpers";

const PRIVATE = ["/", "/enviar", "/recargar", "/solicitudes", "/movimientos", "/cuenta"] as const;

test.describe("Seguridad en el navegador (build de producción con su CSP)", () => {
  test.skip(({ isMobile }) => isMobile, "Igual en cualquier ancho");

  test("cabeceras de seguridad en el documento y en los recursos", async ({ request }) => {
    const response = await request.get("/");
    const headers = response.headers();
    expect(headers["content-security-policy"]).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; " +
        "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    const html = await response.text();
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/); // ningún script en línea
    expect(html).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/); // ningún recurso externo
  });

  test("todo se carga del mismo origen, sin errores de CSP, y el token solo viaja en Authorization", async ({ page, request }) => {
    const account = await createAccountApi(request, "Irene");
    await depositApi(request, account, 1_000);

    const origins = new Set<string>();
    const leaks: string[] = [];
    const errors: string[] = [];
    page.on("request", (sent) => {
      origins.add(new URL(sent.url()).origin);
      if (sent.url().includes(account.token)) leaks.push(`URL ${sent.method()} ${new URL(sent.url()).pathname}`);
      if ((sent.postData() ?? "").includes(account.token)) leaks.push(`cuerpo ${sent.method()} ${new URL(sent.url()).pathname}`);
      for (const [name, value] of Object.entries(sent.headers())) {
        if (name !== "authorization" && value.includes(account.token)) leaks.push(`cabecera ${name}`);
      }
    });
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") errors.push(message.text());
      if (message.text().includes(account.token)) leaks.push("consola");
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await login(page, account);
    for (const path of PRIVATE) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
      expect(await page.content()).not.toContain(account.token);
      expect(page.url()).not.toContain(account.token);
    }
    const storage = await page.evaluate(() => ({ local: window.localStorage.length, cookies: document.cookie }));
    expect(storage).toEqual({ local: 0, cookies: "" });

    expect([...origins]).toEqual(["http://127.0.0.1:4174"]);
    expect(leaks).toEqual([]);
    expect(errors).toEqual([]);

    // Cerrar sesión borra el token de la pestaña y la ruta privada vuelve a /acceso.
    await page.getByRole("button", { name: "Cerrar sesión" }).first().click();
    expect(await page.evaluate(() => window.sessionStorage.getItem("habicapital.session.token"))).toBeNull();
    await page.goto("/cuenta");
    await expect(page).toHaveURL(/\/acceso/);
  });

  test("un token revocado en el servidor cierra la sesión en el navegador", async ({ page, request }) => {
    const account = await createAccountApi(request, "Julián");
    await login(page, account);
    // Se regenera fuera del navegador (en habicapital_test): el token de la pestaña deja de valer.
    const rotated = await request.post("/api/accounts/me/token", { headers: { Authorization: `Bearer ${account.token}` } });
    expect(rotated.status()).toBe(200);
    await page.goto("/movimientos");
    await expect(page).toHaveURL(/\/acceso/);
    await expect(page.getByText(/sesión/i).first()).toBeVisible();
    expect(await page.evaluate(() => window.sessionStorage.getItem("habicapital.session.token"))).toBeNull();
  });
});
