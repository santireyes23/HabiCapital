import { expect, test, type Page } from "@playwright/test";

import { createAccountApi, depositApi, login, requestMoneyApi, type TestAccount } from "./helpers";

test.describe.configure({ mode: "serial" });

const WIDTHS = [320, 375, 768, 1024, 1440] as const;
const PRIVATE = ["/", "/enviar", "/recargar", "/solicitudes", "/movimientos", "/cuenta"] as const;

/** Elementos visibles que se salen por la derecha del viewport (sin contar los recortados a propósito). */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders: string[] = [];
    for (const element of Array.from(document.querySelectorAll("body *"))) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right > width + 1) {
        let clipped = false;
        for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.overflowX !== "visible" && parent.getBoundingClientRect().right <= width + 1) {
            clipped = true;
            break;
          }
        }
        if (!clipped) offenders.push(`${element.tagName.toLowerCase()}.${(element.getAttribute("class") ?? "").slice(0, 60)}`);
      }
    }
    return { scroll: document.documentElement.scrollWidth - width, offenders: offenders.slice(0, 5) };
  });
}

test.describe("Responsive: siete pantallas a 320, 375, 768, 1024 y 1440 px", () => {
  test.skip(({ isMobile }) => isMobile, "Los anchos se fijan aquí; basta con un proyecto");
  let gabriela: TestAccount;

  test.beforeAll(async ({ request }) => {
    gabriela = await createAccountApi(request, "Gabriela Restrepo Valderrama Montoya");
    const hugo = await createAccountApi(request, "Hugo");
    await depositApi(request, gabriela, 9_999_999);
    await requestMoneyApi(request, hugo, gabriela, 10_000_000, "Concepto largo ".repeat(9).trim());
    await requestMoneyApi(request, gabriela, hugo, 1, "x");
  });

  for (const width of WIDTHS) {
    test(`${String(width)} px sin desbordamiento horizontal`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/acceso");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await overflow(page), "/acceso").toEqual({ scroll: 0, offenders: [] });

      await login(page, gabriela);
      for (const path of PRIVATE) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
        expect(await overflow(page), path).toEqual({ scroll: 0, offenders: [] });
      }

      // Confirmaciones y formularios abiertos.
      await page.goto("/solicitudes?rol=recibidas&estado=pendientes&pagina=1");
      const item = page.getByRole("article").first();
      await item.getByRole("button", { name: "Aceptar y transferir" }).click();
      await expect(item.getByText("Saldo estimado después")).toBeVisible();
      expect(await overflow(page), "confirmar pago").toEqual({ scroll: 0, offenders: [] });
      await page.getByRole("button", { name: "Nueva solicitud" }).first().click();
      expect(await overflow(page), "nueva solicitud").toEqual({ scroll: 0, offenders: [] });

      if (width < 1024) {
        await page.getByRole("button", { name: "Menú" }).click();
        await expect(page.locator("#mobile-menu").getByRole("link", { name: "Movimientos" })).toBeVisible();
        expect(await overflow(page), "menú móvil").toEqual({ scroll: 0, offenders: [] });
      }
    });
  }
});
