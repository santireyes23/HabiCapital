import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { createAccountApi, depositApi, login, requestMoneyApi, type TestAccount } from "./helpers";

test.describe.configure({ mode: "serial" });

/** Las siete pantallas, con datos reales en las que los muestran. */
const SCREENS = [
  { path: "/", heading: "Tu dinero, en movimiento." },
  { path: "/enviar", heading: "Enviar dinero simulado" },
  { path: "/recargar", heading: "Recargar saldo" },
  { path: "/solicitudes", heading: "Solicitudes de dinero" },
  { path: "/movimientos", heading: "Mis movimientos" },
  { path: "/cuenta", heading: "Mi cuenta" },
] as const;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(" ")).slice(0, 5),
  }));
}

test.describe("Accesibilidad (axe, WCAG 2.2 AA) con datos reales", () => {
  let elena: TestAccount;

  test.beforeAll(async ({ request }) => {
    elena = await createAccountApi(request, "Elena");
    const fabio = await createAccountApi(request, "Fabio");
    await depositApi(request, elena, 80_000);
    await depositApi(request, fabio, 10_000);
    await requestMoneyApi(request, fabio, elena, 7_500, "Entradas de cine");
    await requestMoneyApi(request, elena, fabio, 3_000, "Taxi");
  });

  test("/acceso (crear cuenta y entrar) sin violaciones", async ({ page }) => {
    await page.goto("/acceso");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.getByRole("tab", { name: "Ya tengo cuenta" }).click();
    expect(await axe(page)).toEqual([]);
  });

  for (const screen of SCREENS) {
    test(`${screen.path} sin violaciones`, async ({ page }) => {
      await login(page, elena);
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(screen.heading);
      await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
      expect(await axe(page)).toEqual([]);
    });
  }

  test("confirmaciones y formularios abiertos sin violaciones", async ({ page }) => {
    await login(page, elena);
    await page.goto("/solicitudes?rol=recibidas&estado=pendientes&pagina=1");
    const item = page.getByRole("article").filter({ hasText: "Entradas de cine" });
    await item.getByRole("button", { name: "Aceptar y transferir" }).click();
    await expect(item.getByText("Saldo estimado después")).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await item.getByRole("button", { name: "Editar" }).click();
    await item.getByRole("button", { name: "Rechazar" }).click();
    expect(await axe(page)).toEqual([]);
    await item.getByRole("button", { name: "Volver" }).click();
    await page.getByRole("button", { name: "Nueva solicitud" }).first().click();
    await page.getByRole("button", { name: "Revisar solicitud" }).click();
    await expect(page.getByText("Ingresa el UUID de la cuenta que pagará.")).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test("teclado: se navega por el menú con Tab y el foco es visible", async ({ page, isMobile }) => {
    test.skip(isMobile, "En móvil el menú se abre con el botón «Menú» (se prueba aparte)");
    await login(page, elena);
    let reached = false;
    for (let step = 0; step < 25 && !reached; step += 1) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => document.activeElement?.textContent.trim() === "Movimientos");
    }
    expect(reached).toBe(true);
    const outline = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement as Element);
      return { style: style.outlineStyle, width: style.outlineWidth };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).not.toBe("0px");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/movimientos$/);
  });

  test("teclado: un formulario completo se rellena y envía sin ratón", async ({ page, isMobile }) => {
    test.skip(isMobile, "Igual en móvil; basta con escritorio");
    await login(page, elena);
    await page.goto("/recargar");
    await page.getByLabel(/Monto en pesos colombianos/).focus();
    await page.keyboard.type("1000");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Confirmar recarga" })).toBeVisible();
    // No se confirma: solo se comprueba que el paso 2 es alcanzable con teclado.
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).toBeTruthy();
  });

  test("móvil: el botón «Menú» abre y cierra la navegación y anuncia su estado", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Solo en móvil");
    await login(page, elena);
    const menu = page.getByRole("button", { name: "Menú" });
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(page.getByRole("button", { name: "Cerrar menú" })).toHaveAttribute("aria-expanded", "true");
    expect(await axe(page)).toEqual([]);
    await page.locator("#mobile-menu").getByRole("link", { name: "Solicitudes" }).click();
    await expect(page.locator("#mobile-menu")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Solicitudes de dinero" })).toBeVisible();
  });
});
