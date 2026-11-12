import { expect, test, type Page } from "@playwright/test";

import {
  balanceOf,
  createAccountApi,
  depositApi,
  idempotencyKeys,
  loseNextResponse,
  requestMoneyApi,
  requestStatus,
  sessionPage,
  type TestAccount,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const card = (page: Page, name: RegExp | string) => page.getByRole("article", { name });

test.describe("Solicitudes de dinero (backend real, habicapital_test)", () => {
  let carla: TestAccount; // paga
  let diego: TestAccount; // solicita

  test.beforeAll(async ({ request }) => {
    carla = await createAccountApi(request, "Carla");
    diego = await createAccountApi(request, "Diego");
    await depositApi(request, carla, 50_000);
  });

  test("crear una solicitud desde la interfaz no mueve dinero", async ({ browser, request }) => {
    const page = await sessionPage(browser, diego);
    await page.getByRole("link", { name: /Solicitudes/ }).first().click();
    await page.getByRole("button", { name: "Nueva solicitud" }).first().click();
    await page.getByLabel(/UUID de la cuenta que pagará/).fill(carla.id);
    await page.getByLabel(/Monto en pesos colombianos/).fill("20000");
    await page.getByLabel(/Concepto/).fill("Almuerzo E2E");
    await page.getByRole("button", { name: "Revisar solicitud" }).click();
    await page.getByRole("button", { name: "Confirmar solicitud" }).click();
    await expect(page.getByRole("heading", { name: "Solicitud creada" })).toBeVisible();
    await page.getByRole("button", { name: "Ver solicitudes enviadas" }).click();
    await expect(card(page, `Solicitud le pediste ${carla.name}`)).toContainText("Pendiente");
    await expect(page.getByRole("tab", { name: /Enviadas/ })).toContainText("1");
    expect(await balanceOf(request, carla)).toBe(50_000);
    expect(await balanceOf(request, diego)).toBe(0);
    await page.context().close();
  });

  test("aceptar tras un corte de red: el reintento usa la misma clave y paga una sola vez", async ({ browser, request }) => {
    const page = await sessionPage(browser, carla);
    await expect(page.getByLabel("1 solicitudes recibidas pendientes")).toBeVisible();
    await page.getByRole("link", { name: "Responder en Solicitudes" }).click();
    await expect(page).toHaveURL(/rol=recibidas&estado=pendientes&pagina=1/);
    const item = card(page, `Solicitud te pide ${diego.name}`);
    await expect(item).toContainText("Almuerzo E2E");
    await expect(item).toContainText("$20.000 COP");

    const keys = idempotencyKeys(page, "/accept");
    await item.getByRole("button", { name: "Aceptar y transferir" }).click();
    await expect(item.getByText("Saldo actual").locator("..")).toContainText("$50.000 COP");
    await expect(item.getByText("Saldo estimado después").locator("..")).toContainText("$30.000 COP");
    await loseNextResponse(page, "/accept");
    await item.getByRole("button", { name: "Confirmar pago" }).click();

    const recovery = page.getByRole("region", { name: "Pago de solicitud sin confirmar" });
    await expect(recovery).toBeVisible();
    expect(await balanceOf(request, carla)).toBe(30_000);
    await recovery.getByRole("button", { name: "Reintentar con la misma clave" }).click();
    await expect(page.getByText("Esta solicitud ya había sido pagada")).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(await balanceOf(request, carla)).toBe(30_000);
    expect(await balanceOf(request, diego)).toBe(20_000);
    await expect(page.getByLabel(/solicitudes recibidas pendientes/)).toHaveCount(0);

    await page.getByRole("button", { name: "Aceptadas" }).click();
    await expect(item).toContainText("Aceptada");
    await expect(item.getByRole("button")).toHaveCount(0);
    await page.context().close();
  });

  test("rechazar (pagador) y cancelar (solicitante) con confirmación, sin mover dinero", async ({ browser, request }) => {
    const toReject = await requestMoneyApi(request, diego, carla, 5_000, "Para rechazar");
    const toCancel = await requestMoneyApi(request, diego, carla, 6_000, "Para cancelar");

    const payer = await sessionPage(browser, carla);
    await payer.goto("/solicitudes?rol=recibidas&estado=pendientes&pagina=1");
    const rejectCard = payer.getByRole("article").filter({ hasText: "Para rechazar" });
    await rejectCard.getByRole("button", { name: "Rechazar" }).click();
    await rejectCard.getByRole("button", { name: "Sí, rechazar" }).click();
    await expect(payer.getByText("Solicitud rechazada")).toBeVisible();
    expect(await requestStatus(request, carla, toReject)).toBe("REJECTED");
    // La cancelable sigue sin botón de cancelar para quien paga.
    await expect(payer.getByRole("article").filter({ hasText: "Para cancelar" }).getByRole("button", { name: "Cancelar solicitud" })).toHaveCount(0);
    await payer.context().close();

    const requester = await sessionPage(browser, diego);
    await requester.goto("/solicitudes?rol=enviadas&estado=pendientes&pagina=1");
    const cancelCard = requester.getByRole("article").filter({ hasText: "Para cancelar" });
    await expect(cancelCard.getByRole("button", { name: "Aceptar y transferir" })).toHaveCount(0);
    await cancelCard.getByRole("button", { name: "Cancelar solicitud" }).click();
    await cancelCard.getByRole("button", { name: "Sí, cancelar solicitud" }).click();
    await expect(requester.getByText("Solicitud cancelada")).toBeVisible();
    expect(await requestStatus(request, diego, toCancel)).toBe("CANCELLED");

    await requester.goto("/solicitudes?rol=enviadas&estado=todas&pagina=1");
    await expect(requester.getByRole("article").filter({ hasText: "Para rechazar" })).toContainText("Rechazada");
    await expect(requester.getByRole("article").filter({ hasText: "Para cancelar" })).toContainText("Cancelada");
    await requester.context().close();

    expect(await balanceOf(request, carla)).toBe(30_000);
    expect(await balanceOf(request, diego)).toBe(20_000);
  });

  test("aceptar sin saldo suficiente: la solicitud sigue pendiente y nada cambia", async ({ browser, request }) => {
    const id = await requestMoneyApi(request, diego, carla, 45_000, "Demasiado");
    const page = await sessionPage(browser, carla);
    await page.goto("/solicitudes?rol=recibidas&estado=pendientes&pagina=1");
    const item = page.getByRole("article").filter({ hasText: "Demasiado" });
    await item.getByRole("button", { name: "Aceptar y transferir" }).click();
    await item.getByRole("button", { name: "Confirmar pago" }).click();
    await expect(item.getByText("Saldo insuficiente")).toBeVisible();
    await expect(item.getByRole("button", { name: "Aceptar y transferir" })).toBeVisible();
    expect(await requestStatus(request, carla, id)).toBe("PENDING");
    expect(await balanceOf(request, carla)).toBe(30_000);
    await page.context().close();
  });

  test("una solicitud ya resuelta en otra pestaña se informa al intentar pagarla", async ({ browser, request }) => {
    const id = await requestMoneyApi(request, diego, carla, 1_000, "Doble pestaña");
    const page = await sessionPage(browser, carla);
    await page.goto("/solicitudes?rol=recibidas&estado=pendientes&pagina=1");
    const item = page.getByRole("article").filter({ hasText: "Doble pestaña" });
    await expect(item).toBeVisible();
    // Diego la cancela por su lado (otra sesión) mientras Carla la tiene en pantalla.
    const cancel = await request.post(`/api/money-requests/${id}/cancel`, { headers: { Authorization: `Bearer ${diego.token}` } });
    expect(cancel.status()).toBe(200);
    await item.getByRole("button", { name: "Aceptar y transferir" }).click();
    await item.getByRole("button", { name: "Confirmar pago" }).click();
    await expect(page.getByText("La solicitud ya no está pendiente").first()).toBeVisible();
    expect(await balanceOf(request, carla)).toBe(30_000);
    await page.context().close();
  });
});
