import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createIdempotencyManager, PENDING_OPERATIONS_STORAGE_KEY } from "../../api/idempotency";
import type { AccountRead, MoneyRequestStatus } from "../../api/types";
import { TOKEN_STORAGE_KEY } from "../../session/tokenStore";
import { deferred, fakeBackend, networkDown, type FakeBackend } from "../../test/fakeBackend";
import { moneyRequest } from "../../test/fixtures";
import { jsonResponse, type RecordedRequest } from "../../test/http";
import { newTabStorage, renderApp } from "../../test/renderApp";
import { acceptScope, createScope } from "./requests";

const TOKEN = "reqTok_Zx9abcDEF123ghiJKL456mnoPQR789stuVWxy";
const OTHER_TOKEN = "valTok_Qw7ertyUIOP456asdfGHJ789zxcvBNmlkj";
const THIRD_TOKEN = "matTok_Lp0okmIJN987uhbYGV654tfcRDX321esz";

const party = (account: AccountRead) => ({ account_id: account.id, owner_name: account.owner_name });

function setup(balance = 500_000) {
  const backend = fakeBackend();
  const me = backend.addAccount(TOKEN, "Camilo Aristizábal", balance);
  const valentina = backend.addAccount(OTHER_TOKEN, "Valentina Gómez", 50_000);
  const mateo = backend.addAccount(THIRD_TOKEN, "Mateo Restrepo", 0);
  const storage = newTabStorage();
  storage.session.set(TOKEN_STORAGE_KEY, TOKEN);
  return { backend, me, valentina, mateo, storage };
}
type Ctx = ReturnType<typeof setup>;

/** Valentina le pide a Camilo (recibida). */
function received(ctx: Ctx, amount: number, status: MoneyRequestStatus = "PENDING", minute = 0, description: string | null = "Almuerzo") {
  const request = moneyRequest(party(ctx.valentina), party(ctx.me), amount, status, at(minute), description);
  ctx.backend.addMoneyRequest(request);
  return request;
}

/** Camilo le pide a Valentina (enviada). */
function sent(ctx: Ctx, amount: number, status: MoneyRequestStatus = "PENDING", minute = 0) {
  const request = moneyRequest(party(ctx.me), party(ctx.valentina), amount, status, at(minute), "Arriendo");
  ctx.backend.addMoneyRequest(request);
  return request;
}

function at(minute: number) {
  const hour = String(10 + Math.floor(minute / 60)).padStart(2, "0");
  return `2026-11-12T${hour}:${String(minute % 60).padStart(2, "0")}:00Z`;
}

async function open(path = "/solicitudes", ctx = setup(), timeoutMs?: number) {
  const view = renderApp({ path, backend: ctx.backend, storage: ctx.storage, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
  await screen.findByRole("heading", { level: 1, name: "Solicitudes de dinero" });
  await waitFor(() => {
    expect(screen.queryByLabelText("Cargando solicitudes")).not.toBeInTheDocument();
  });
  return { ...ctx, ...view };
}

type User = ReturnType<typeof renderApp>["user"];
const location = () => screen.getByTestId("location").textContent;
const cards = () => screen.queryAllByRole("article", { name: /^Solicitud / });
const card = (name: string) => screen.getByRole("article", { name });
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const filterButton = (name: string) => within(screen.getByRole("group", { name: "Filtrar por estado" })).getByRole("button", { name });
const listCalls = (backend: FakeBackend) =>
  backend
    .requestsTo("/money-requests", "GET")
    .map((request) => request.url)
    .filter((url) => !url.includes("limit=1&") && !url.endsWith("limit=1"));
const keyOf = (request: RecordedRequest | undefined) => request?.headers.get("Idempotency-Key");
const accepts = (backend: FakeBackend, id: string) => backend.requestsTo(`/money-requests/${id}/accept`, "POST");
const creates = (backend: FakeBackend) => backend.requestsTo("/money-requests", "POST");
const badge = () => screen.queryAllByLabelText(/solicitudes recibidas pendientes$/)[0];

describe("Solicitudes: listado, pestañas y filtros", () => {
  it("muestra las recibidas con datos reales: contraparte, UUID, monto, concepto, fecha y estado", async () => {
    const ctx = setup();
    received(ctx, 42_500, "PENDING", 5, "Almuerzo del viernes");
    await open("/solicitudes", ctx);
    const item = card("Solicitud te pide Valentina Gómez");
    expect(item).toHaveTextContent("Pendiente");
    expect(item).toHaveTextContent("Solicitante");
    expect(item).toHaveTextContent(`UUID: ${ctx.valentina.id}`);
    expect(item).toHaveTextContent("Almuerzo del viernes");
    expect(item).toHaveTextContent("Monto por transferir");
    expect(item).toHaveTextContent("$42.500 COP");
    expect(within(item).getByRole("button", { name: "Aceptar y transferir" })).toBeInTheDocument();
    expect(within(item).getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
    expect(location()).toBe("/solicitudes");
    expect(listCalls(ctx.backend)[0]).toBe("/api/money-requests?role=received&limit=10&offset=0&order=desc");
  });

  it("contadores reales en las pestañas y cambio a «Enviadas» en la URL", async () => {
    const ctx = setup();
    received(ctx, 1_000);
    received(ctx, 2_000, "ACCEPTED", 1);
    sent(ctx, 3_000, "PENDING", 2);
    const { user } = await open("/solicitudes", ctx);
    await waitFor(() => {
      expect(tab(/Recibidas/)).toHaveTextContent("Recibidas2");
    });
    expect(tab(/Enviadas/)).toHaveTextContent("Enviadas1");
    expect(tab(/Recibidas/)).toHaveAttribute("aria-selected", "true");

    await user.click(tab(/Enviadas/));
    expect(location()).toBe("/solicitudes?rol=enviadas&estado=todas&pagina=1");
    await waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
    const item = card("Solicitud le pediste Valentina Gómez");
    expect(item).toHaveTextContent("Pagador");
    expect(within(item).getByRole("button", { name: "Cancelar solicitud" })).toBeInTheDocument();
    expect(within(item).queryByRole("button", { name: "Aceptar y transferir" })).not.toBeInTheDocument();
  });

  it("los filtros consultan el estado al backend y se reflejan en la URL", async () => {
    const ctx = setup();
    received(ctx, 1_000, "PENDING");
    received(ctx, 2_000, "REJECTED", 1);
    const { user } = await open("/solicitudes", ctx);
    await user.click(filterButton("Rechazadas"));
    expect(location()).toBe("/solicitudes?rol=recibidas&estado=rechazadas&pagina=1");
    await waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
    expect(cards()[0]).toHaveTextContent("Rechazada");
    expect(filterButton("Rechazadas")).toHaveAttribute("aria-pressed", "true");
    expect(listCalls(ctx.backend).at(-1)).toBe("/api/money-requests?role=received&status=REJECTED&limit=10&offset=0&order=desc");
  });

  it("estado vacío por filtro y por papel, con acción en «Enviadas»", async () => {
    const ctx = setup();
    const { user } = await open("/solicitudes", ctx);
    expect(await screen.findByText("Nadie te ha pedido dinero todavía")).toBeInTheDocument();
    await user.click(filterButton("Aceptadas"));
    expect(await screen.findByText("No hay solicitudes recibidas en «Aceptadas»")).toBeInTheDocument();
    await user.click(tab(/Enviadas/));
    expect(await screen.findByText("No hay solicitudes enviadas en «Aceptadas»")).toBeInTheDocument();
    await user.click(filterButton("Todas"));
    expect(await screen.findByText("Aún no has pedido dinero")).toBeInTheDocument();
  });

  it("estado de carga y error con «Reintentar»", async () => {
    const ctx = setup();
    received(ctx, 1_000);
    const pending = deferred();
    ctx.backend.nextFor("GET", "/money-requests", pending.responder);
    const { user } = renderApp({ path: "/solicitudes", backend: ctx.backend, storage: ctx.storage });
    expect(await screen.findByLabelText("Cargando solicitudes")).toBeInTheDocument();
    pending.release(jsonResponse(503, { detail: "Servicio no disponible" }));
    const error = await screen.findByText("No se pudieron cargar las solicitudes");
    await user.click(within(error.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => {
      expect(cards()).toHaveLength(1);
    });
  });

  it("paginación de 10 con contador, parámetros en la URL y offset correcto", async () => {
    const ctx = setup();
    for (let index = 0; index < 23; index += 1) received(ctx, 1_000 + index, "PENDING", index);
    const { user } = await open("/solicitudes", ctx);
    expect(cards()).toHaveLength(10);
    expect(screen.getByText(/Mostrando/)).toHaveTextContent("Mostrando 1 - 10 de 23 solicitudes");
    await user.click(screen.getByRole("button", { name: "Página 3" }));
    expect(location()).toBe("/solicitudes?rol=recibidas&estado=todas&pagina=3");
    await waitFor(() => {
      expect(cards()).toHaveLength(3);
    });
    expect(screen.getByText(/Mostrando/)).toHaveTextContent("Mostrando 21 - 23 de 23 solicitudes");
    expect(listCalls(ctx.backend).at(-1)).toContain("offset=20");
    expect(screen.getByRole("button", { name: "Página 3" })).toHaveAttribute("aria-current", "page");
  });

  it("abre directamente la URL con papel, filtro y página", async () => {
    const ctx = setup();
    for (let index = 0; index < 12; index += 1) sent(ctx, 1_000, "PENDING", index);
    await open("/solicitudes?rol=enviadas&estado=pendientes&pagina=2", ctx);
    await waitFor(() => {
      expect(cards()).toHaveLength(2);
    });
    expect(listCalls(ctx.backend)[0]).toBe("/api/money-requests?role=sent&status=PENDING&limit=10&offset=10&order=desc");
  });

  it.each([
    ["/solicitudes?rol=otro&estado=nada&pagina=abc", "/solicitudes?rol=recibidas&estado=todas&pagina=1"],
    ["/solicitudes?pagina=0", "/solicitudes?rol=recibidas&estado=todas&pagina=1"],
  ])("normaliza parámetros inválidos (%s)", async (path, expected) => {
    await open(path);
    await waitFor(() => {
      expect(location()).toBe(expected);
    });
  });

  it("una página fuera de rango lleva a la última", async () => {
    const ctx = setup();
    for (let index = 0; index < 12; index += 1) received(ctx, 1_000, "PENDING", index);
    await open("/solicitudes?rol=recibidas&estado=todas&pagina=9", ctx);
    await waitFor(() => {
      expect(location()).toBe("/solicitudes?rol=recibidas&estado=todas&pagina=2");
    });
    await waitFor(() => {
      expect(cards()).toHaveLength(2);
    });
  });

  it("los estados finales no tienen acciones y muestran su pie", async () => {
    const ctx = setup();
    received(ctx, 1_000, "ACCEPTED", 1);
    received(ctx, 2_000, "REJECTED", 2);
    sent(ctx, 3_000, "CANCELLED", 3);
    const { user } = await open("/solicitudes", ctx);
    await waitFor(() => {
      expect(cards()).toHaveLength(2);
    });
    for (const item of cards()) {
      expect(within(item).queryByRole("button")).not.toBeInTheDocument();
      expect(item).toHaveTextContent(/ID: [0-9a-f]{8}/);
    }
    await user.click(tab(/Enviadas/));
    await waitFor(() => {
      expect(cards()[0]).toHaveTextContent("Cancelada");
    });
    expect(within(cards()[0] as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Solicitudes: nueva solicitud", () => {
  async function openForm(ctx = setup(), timeoutMs?: number) {
    const view = await open("/solicitudes", ctx, timeoutMs);
    await view.user.click(screen.getByRole("button", { name: "Nueva solicitud" }));
    await screen.findByText("Paso 1 de 2: Datos");
    return view;
  }
  const payerInput = () => screen.getByLabelText(/UUID de la cuenta que pagará/);
  const amountInput = () => screen.getByLabelText(/Monto en pesos colombianos/);
  const conceptInput = () => screen.getByLabelText(/Concepto/);

  async function fill(user: User, payer: string, amount: string, concept = "") {
    await user.clear(payerInput());
    if (payer !== "") await user.type(payerInput(), payer);
    await user.clear(amountInput());
    if (amount !== "") await user.type(amountInput(), amount);
    await user.clear(conceptInput());
    if (concept !== "") await user.type(conceptInput(), concept);
    await user.click(screen.getByRole("button", { name: "Revisar solicitud" }));
  }

  it("valida UUID, propia cuenta, monto y concepto antes de llamar al backend", async () => {
    const ctx = setup();
    const { user } = await openForm(ctx);
    await fill(user, "", "");
    expect(screen.getByText("Ingresa el UUID de la cuenta que pagará.")).toBeInTheDocument();
    await fill(user, "no-es-un-uuid", "1000");
    expect(screen.getByText(/El UUID debe tener 36 caracteres/)).toBeInTheDocument();
    await fill(user, ctx.me.id.toUpperCase(), "1000");
    expect(screen.getByText("No puedes solicitarte dinero a ti mismo.")).toBeInTheDocument();
    await fill(user, ctx.valentina.id, "10000001");
    expect(amountInput()).toHaveAttribute("aria-invalid", "true");
    await fill(user, ctx.valentina.id, "0");
    expect(amountInput()).toHaveAttribute("aria-invalid", "true");
    expect(creates(ctx.backend)).toHaveLength(0);
    expect(screen.queryByText("Paso 2 de 2: Confirmar")).not.toBeInTheDocument();
  });

  it("concepto: máximo 140 caracteres", async () => {
    const ctx = setup();
    const { user } = await openForm(ctx);
    await user.type(payerInput(), ctx.valentina.id);
    await user.type(amountInput(), "1000");
    await user.click(conceptInput());
    await user.paste("x".repeat(141));
    await user.click(screen.getByRole("button", { name: "Revisar solicitud" }));
    expect(conceptInput()).toHaveAttribute("aria-invalid", "true");
    expect(creates(ctx.backend)).toHaveLength(0);
  });

  it("«Pegar» usa el portapapeles y, si falla, explica cómo pegar a mano", async () => {
    const ctx = setup();
    const { user } = await openForm(ctx);
    vi.spyOn(navigator.clipboard, "readText").mockResolvedValueOnce(`  ${ctx.valentina.id}  `);
    await user.click(screen.getByRole("button", { name: "Pegar" }));
    await waitFor(() => {
      expect(payerInput()).toHaveValue(ctx.valentina.id);
    });
    vi.spyOn(navigator.clipboard, "readText").mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    await user.click(screen.getByRole("button", { name: "Pegar" }));
    expect(await screen.findByText(/Pega el UUID manualmente/)).toBeInTheDocument();
    expect(payerInput()).toHaveValue(ctx.valentina.id);
  });

  it("confirma, crea con Idempotency-Key, no mueve dinero y actualiza «Enviadas»", async () => {
    const ctx = setup();
    const { user } = await openForm(ctx);
    await fill(user, ctx.valentina.id.toUpperCase(), "25000", "Mercado");
    await screen.findByText("Paso 2 de 2: Confirmar");
    expect(screen.getByText("Cuenta que pagará").parentElement).toHaveTextContent(ctx.valentina.id);
    expect(screen.getByText("Monto a solicitar").parentElement).toHaveTextContent("$25.000 COP");
    await user.click(screen.getByRole("button", { name: "Confirmar solicitud" }));
    expect(await screen.findByRole("heading", { name: "Solicitud creada" })).toBeInTheDocument();

    const [post] = creates(ctx.backend);
    expect(post?.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(keyOf(post)).toMatch(/^[A-Za-z0-9._:-]{1,100}$/);
    expect(JSON.parse(post?.body ?? "{}")).toEqual({ payer_account_id: ctx.valentina.id, amount: 25_000, description: "Mercado" });
    expect(ctx.me.balance).toBe(500_000);
    expect(ctx.valentina.balance).toBe(50_000);
    expect(ctx.storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).toBeNull();
    await waitFor(() => {
      expect(tab(/Enviadas/)).toHaveTextContent("Enviadas1");
    });

    await user.click(screen.getByRole("button", { name: "Ver solicitudes enviadas" }));
    expect(location()).toBe("/solicitudes?rol=enviadas&estado=todas&pagina=1");
    await waitFor(() => {
      expect(card("Solicitud le pediste Valentina Gómez")).toHaveTextContent("$25.000 COP");
    });
  });

  it("sin concepto, el cuerpo no incluye el campo; «Editar» conserva los datos", async () => {
    const ctx = setup();
    const { user } = await openForm(ctx);
    await fill(user, ctx.valentina.id, "1000");
    await user.click(await screen.findByRole("button", { name: "Editar" }));
    expect(payerInput()).toHaveValue(ctx.valentina.id);
    expect(amountInput()).toHaveValue("1000");
    await user.click(screen.getByRole("button", { name: "Revisar solicitud" }));
    await user.click(await screen.findByRole("button", { name: "Confirmar solicitud" }));
    await screen.findByRole("heading", { name: "Solicitud creada" });
    expect(JSON.parse(creates(ctx.backend)[0]?.body ?? "{}")).toEqual({ payer_account_id: ctx.valentina.id, amount: 1_000 });
  });

  it("un doble clic crea una sola solicitud", async () => {
    const ctx = setup();
    const { user } = await openForm(ctx);
    await fill(user, ctx.valentina.id, "1000");
    const hold = deferred();
    ctx.backend.nextFor("POST", "/money-requests", hold.responder);
    const button = await screen.findByRole("button", { name: "Confirmar solicitud" });
    await user.dblClick(button);
    expect(screen.getByRole("button", { name: "Creando solicitud…" })).toBeDisabled();
    hold.release(await ctx.backend.fetchFn("/api/money-requests", {
      method: "POST",
      headers: creates(ctx.backend)[0]?.headers ?? {},
      body: creates(ctx.backend)[0]?.body ?? null,
    }));
    await screen.findByRole("heading", { name: "Solicitud creada" });
    expect(creates(ctx.backend)).toHaveLength(2);
    expect(ctx.backend.moneyRequests).toHaveLength(1);
  });

  it("404: el pagador no existe, el error va al campo del UUID", async () => {
    const ctx = setup();
    const { user } = await openForm(ctx);
    await fill(user, "11111111-2222-4333-8444-555555555555", "1000");
    await user.click(await screen.findByRole("button", { name: "Confirmar solicitud" }));
    expect(await screen.findByText("Cuenta destinataria no encontrada")).toBeInTheDocument();
    expect(payerInput()).toHaveAttribute("aria-invalid", "true");
    expect(ctx.storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).toBeNull();
  });

  it("422 de negocio: muestra el mensaje real del servidor", async () => {
    const ctx = setup();
    const { user } = await openForm(ctx);
    await fill(user, ctx.valentina.id, "1000");
    ctx.backend.nextFor("POST", "/money-requests", () => jsonResponse(422, { detail: "No puedes solicitarte dinero a ti mismo" }));
    await user.click(await screen.findByRole("button", { name: "Confirmar solicitud" }));
    expect(await screen.findByText("No puedes solicitarte dinero a ti mismo")).toBeInTheDocument();
  });

  it("422 de validación de FastAPI: error junto al campo", async () => {
    const ctx = setup();
    const { user } = await openForm(ctx);
    await fill(user, ctx.valentina.id, "1000");
    ctx.backend.nextFor("POST", "/money-requests", () =>
      jsonResponse(422, { detail: [{ type: "less_than_equal", loc: ["body", "amount"], msg: "invalid" }] }),
    );
    await user.click(await screen.findByRole("button", { name: "Confirmar solicitud" }));
    expect(await screen.findByText(/El servidor no aceptó el monto/)).toBeInTheDocument();
  });

  it("respuesta repetida: «Esta solicitud ya se había creado»", async () => {
    const ctx = setup();
    const { user } = await openForm(ctx);
    await fill(user, ctx.valentina.id, "1000");
    ctx.backend.nextFor("POST", "/money-requests", async (request) => {
      const first = await ctx.backend.fetchFn("/api/money-requests", { method: "POST", headers: request.headers, body: request.body });
      return jsonResponse(201, await first.json(), { "Idempotent-Replayed": "true" });
    });
    await user.click(await screen.findByRole("button", { name: "Confirmar solicitud" }));
    expect(await screen.findByRole("heading", { name: "Esta solicitud ya se había creado" })).toBeInTheDocument();
  });

  it.each([
    ["error de red", () => networkDown],
    ["error 5xx", () => () => jsonResponse(502, { detail: "Bad Gateway" })],
    ["respuesta 2xx ilegible", () => () => jsonResponse(201, { ok: true })],
  ])("%s: «No sabemos si la solicitud se creó», sin reintento automático", async (_name, responder) => {
    const ctx = setup();
    const { user } = await openForm(ctx);
    await fill(user, ctx.valentina.id, "1000");
    ctx.backend.nextFor("POST", "/money-requests", responder());
    await user.click(await screen.findByRole("button", { name: "Confirmar solicitud" }));
    expect(await screen.findByText("No sabemos si la solicitud se creó")).toBeInTheDocument();
    expect(creates(ctx.backend)).toHaveLength(1);
    expect(ctx.storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).not.toBeNull();
  });

  it("timeout: el reintento usa la misma clave y el mismo cuerpo; si ya se creó, no se duplica", async () => {
    const ctx = setup();
    const { user } = await openForm(ctx, 50);
    await fill(user, ctx.valentina.id, "1000", "Pago");
    ctx.backend.nextFor("POST", "/money-requests", async (request) => {
      await ctx.backend.fetchFn("/api/money-requests", { method: "POST", headers: request.headers, body: request.body });
      return new Promise<Response>((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    await user.click(await screen.findByRole("button", { name: "Confirmar solicitud" }));
    expect(await screen.findByText("No sabemos si la solicitud se creó")).toBeInTheDocument();
    expect(screen.getAllByRole("alert").map((node) => node.textContent).join(" ")).toContain("El servidor tardó demasiado en responder.");

    await user.click(screen.getByRole("button", { name: "Reintentar con la misma clave" }));
    expect(await screen.findByRole("heading", { name: "Esta solicitud ya se había creado" })).toBeInTheDocument();
    const [, original, retry] = creates(ctx.backend);
    expect(keyOf(retry)).toBe(keyOf(original));
    expect(retry?.body).toBe(original?.body);
    expect(ctx.backend.moneyRequests).toHaveLength(1);
  });

  it("tras recargar, el panel se abre solo con la solicitud pendiente y la misma clave", async () => {
    const ctx = setup();
    const first = await openForm(ctx);
    await fill(first.user, ctx.valentina.id, "1000");
    ctx.backend.nextFor("POST", "/money-requests", networkDown);
    await first.user.click(await screen.findByRole("button", { name: "Confirmar solicitud" }));
    await screen.findByText("No sabemos si la solicitud se creó");
    first.unmount();

    const second = await open("/solicitudes", ctx);
    expect(await screen.findByText(/Hay una solicitud de esta sesión sin respuesta confirmada/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nueva solicitud" })).toBeDisabled();
    await second.user.click(screen.getByRole("button", { name: "Reintentar con la misma clave" }));
    expect(await screen.findByRole("heading", { name: "Solicitud creada" })).toBeInTheDocument();
    const [a, b] = creates(ctx.backend);
    expect(keyOf(b)).toBe(keyOf(a));
  });

  it("descartar exige confirmación y explica que no cancela nada en el servidor", async () => {
    const ctx = setup();
    const { user } = await openForm(ctx);
    await fill(user, ctx.valentina.id, "1000");
    ctx.backend.nextFor("POST", "/money-requests", networkDown);
    await user.click(await screen.findByRole("button", { name: "Confirmar solicitud" }));
    await screen.findByText("No sabemos si la solicitud se creó");
    await user.click(screen.getByRole("button", { name: "Dejar de intentar recuperar" }));
    expect(screen.getByText("¿Dejar de intentar recuperar esta solicitud?")).toBeInTheDocument();
    expect(ctx.storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Sí, dejar de intentar recuperar" }));
    expect(await screen.findByText("Se descartó la información local")).toBeInTheDocument();
    expect(ctx.storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("link", { name: "Ver solicitudes enviadas" })).toHaveAttribute(
      "href",
      "/solicitudes?rol=enviadas&estado=todas&pagina=1",
    );
  });

  it("una nueva solicitud distinta usa otra clave", async () => {
    const ctx = setup();
    const { user } = await openForm(ctx);
    await fill(user, ctx.valentina.id, "1000");
    await user.click(await screen.findByRole("button", { name: "Confirmar solicitud" }));
    await screen.findByRole("heading", { name: "Solicitud creada" });
    await user.click(screen.getByRole("button", { name: "Crear otra solicitud" }));
    await fill(user, ctx.mateo.id, "2000");
    await user.click(await screen.findByRole("button", { name: "Confirmar solicitud" }));
    await screen.findByRole("heading", { name: "Solicitud creada" });
    const [a, b] = creates(ctx.backend);
    expect(keyOf(b)).not.toBe(keyOf(a));
  });
});

describe("Solicitudes: aceptar y transferir", () => {
  it("confirmación con solicitante, UUID, monto, saldo real y estimado y aviso de fondos", async () => {
    const ctx = setup(500_000);
    received(ctx, 42_500);
    const { user } = await open("/solicitudes", ctx);
    const name = "Solicitud te pide Valentina Gómez";
    await user.click(within(card(name)).getByRole("button", { name: "Aceptar y transferir" }));
    const item = card(name);
    expect(within(item).getByText("Aceptar transfiere fondos simulados")).toBeInTheDocument();
    const requesterRow = within(item).getByText("Solicitante", { selector: "p" }).parentElement;
    expect(requesterRow).toHaveTextContent("Valentina Gómez");
    expect(requesterRow).toHaveTextContent(ctx.valentina.id);
    expect(within(item).getByText("Monto solicitado").parentElement).toHaveTextContent("$42.500 COP");
    await waitFor(() => {
      expect(within(item).getByText("Saldo actual").parentElement).toHaveTextContent("$500.000 COP");
    });
    expect(within(item).getByText("Saldo estimado después").parentElement).toHaveTextContent("$457.500 COP");
    expect(accepts(ctx.backend, ctx.backend.moneyRequests[0]?.id ?? "")).toHaveLength(0);
    await user.click(within(item).getByRole("button", { name: "Editar" }));
    expect(within(card(name)).getByRole("button", { name: "Aceptar y transferir" })).toBeInTheDocument();
  });

  it("éxito: Idempotency-Key, saldo del servidor, toast, listas, contador y barra lateral", async () => {
    const ctx = setup(500_000);
    const request = received(ctx, 42_500);
    const { user } = await open("/solicitudes", ctx);
    await waitFor(() => {
      expect(badge()).toHaveTextContent("1");
    });
    const name = "Solicitud te pide Valentina Gómez";
    await user.click(within(card(name)).getByRole("button", { name: "Aceptar y transferir" }));
    await user.click(within(card(name)).getByRole("button", { name: "Confirmar pago" }));
    expect(await screen.findByText("Transacción completada")).toBeInTheDocument();
    expect(screen.getByText(/Pagaste \$42\.500 COP a Valentina Gómez/)).toBeInTheDocument();

    const [post] = accepts(ctx.backend, request.id);
    expect(keyOf(post)).toMatch(/^[A-Za-z0-9._:-]{1,100}$/);
    expect(post?.body ?? null).toBeNull();
    expect(ctx.me.balance).toBe(457_500);
    expect(ctx.valentina.balance).toBe(92_500);
    await waitFor(() => {
      expect(card(name)).toHaveTextContent("Aceptada");
    });
    expect(within(card(name)).queryByRole("button")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(badge()).toBeUndefined();
    });
    expect(screen.getByText(/Saldo actualizado: \$457\.500 COP/)).toBeInTheDocument();
    expect(ctx.storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).toBeNull();
  });

  it("después de aceptar, Inicio y Movimientos muestran datos frescos", async () => {
    const ctx = setup(500_000);
    received(ctx, 10_000);
    const { user } = await open("/solicitudes", ctx);
    const name = "Solicitud te pide Valentina Gómez";
    await user.click(within(card(name)).getByRole("button", { name: "Aceptar y transferir" }));
    await user.click(within(card(name)).getByRole("button", { name: "Confirmar pago" }));
    await screen.findByText("Transacción completada");
    const homeCallsBefore = ctx.backend.requestsTo("/accounts/me/movements").length;

    await user.click(screen.getAllByRole("link", { name: /Inicio/ })[0] as HTMLElement);
    await screen.findByRole("region", { name: "Solicitudes de dinero" });
    await waitFor(() => {
      expect(screen.getByRole("article", { name: "Solicitud te pide Valentina Gómez" })).toHaveTextContent("Aceptada");
    });
    expect(ctx.backend.requestsTo("/accounts/me/movements").length).toBeGreaterThan(homeCallsBefore);
    expect(screen.queryByRole("link", { name: "Responder en Solicitudes" })).not.toBeInTheDocument();
  });

  it("respuesta repetida: «Esta solicitud ya había sido pagada»", async () => {
    const ctx = setup(500_000);
    const request = received(ctx, 1_000);
    ctx.backend.nextFor("POST", `/money-requests/${request.id}/accept`, async (incoming) => {
      const response = await ctx.backend.fetchFn(`/api/money-requests/${request.id}/accept`, { method: "POST", headers: incoming.headers });
      return jsonResponse(200, await response.json(), { "Idempotent-Replayed": "true" });
    });
    const { user } = await open("/solicitudes", ctx);
    const name = "Solicitud te pide Valentina Gómez";
    await user.click(within(card(name)).getByRole("button", { name: "Aceptar y transferir" }));
    await user.click(within(card(name)).getByRole("button", { name: "Confirmar pago" }));
    expect(await screen.findByText("Esta solicitud ya había sido pagada")).toBeInTheDocument();
    expect(ctx.me.balance).toBe(499_000);
  });

  it("un doble clic paga una sola vez", async () => {
    const ctx = setup(500_000);
    const request = received(ctx, 1_000);
    const { user } = await open("/solicitudes", ctx);
    const name = "Solicitud te pide Valentina Gómez";
    const hold = deferred();
    ctx.backend.nextFor("POST", `/money-requests/${request.id}/accept`, hold.responder);
    await user.click(within(card(name)).getByRole("button", { name: "Aceptar y transferir" }));
    await user.dblClick(within(card(name)).getByRole("button", { name: "Confirmar pago" }));
    expect(within(card(name)).getByRole("button", { name: "Procesando pago…" })).toBeDisabled();
    expect(accepts(ctx.backend, request.id)).toHaveLength(1);
    const [held] = accepts(ctx.backend, request.id);
    hold.release(await ctx.backend.fetchFn(`/api/money-requests/${request.id}/accept`, { method: "POST", headers: held?.headers ?? {} }));
    await screen.findByText("Transacción completada");
    expect(ctx.me.balance).toBe(499_000);
  });

  it("409 saldo insuficiente: aviso, sigue pendiente y nada queda por recuperar", async () => {
    const ctx = setup(500);
    received(ctx, 42_500);
    const { user } = await open("/solicitudes", ctx);
    const name = "Solicitud te pide Valentina Gómez";
    await user.click(within(card(name)).getByRole("button", { name: "Aceptar y transferir" }));
    await user.click(within(card(name)).getByRole("button", { name: "Confirmar pago" }));
    expect(await within(card(name)).findByText("Saldo insuficiente")).toBeInTheDocument();
    expect(card(name)).toHaveTextContent("Pendiente");
    expect(within(card(name)).getByRole("button", { name: "Aceptar y transferir" })).toBeInTheDocument();
    expect(ctx.me.balance).toBe(500);
    expect(ctx.storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).toBeNull();
  });

  it("409 ya resuelta: avisa y recarga con el estado real", async () => {
    const ctx = setup();
    const request = received(ctx, 1_000);
    const { user } = await open("/solicitudes", ctx);
    request.status = "CANCELLED";
    request.resolved_at = "2026-11-12T12:00:00Z";
    const name = "Solicitud te pide Valentina Gómez";
    await user.click(within(card(name)).getByRole("button", { name: "Aceptar y transferir" }));
    await user.click(within(card(name)).getByRole("button", { name: "Confirmar pago" }));
    expect(await screen.findAllByText("La solicitud ya no está pendiente")).toHaveLength(2); // en la tarjeta y en el aviso de la página
    await waitFor(() => {
      expect(card(name)).toHaveTextContent("Cancelada");
    });
    expect(ctx.me.balance).toBe(500_000);
  });

  it("404: la solicitud ya no existe para esta cuenta", async () => {
    const ctx = setup();
    const request = received(ctx, 1_000);
    const { user } = await open("/solicitudes", ctx);
    ctx.backend.nextFor("POST", `/money-requests/${request.id}/accept`, () => jsonResponse(404, { detail: "Solicitud no encontrada" }));
    const name = "Solicitud te pide Valentina Gómez";
    await user.click(within(card(name)).getByRole("button", { name: "Aceptar y transferir" }));
    await user.click(within(card(name)).getByRole("button", { name: "Confirmar pago" }));
    expect(await screen.findAllByText("Solicitud no encontrada")).toHaveLength(2); // en la tarjeta y en el aviso de la página
  });

  it.each([
    ["error de red", () => networkDown],
    ["error 5xx", () => () => jsonResponse(500, { detail: "Internal Server Error" })],
    ["respuesta 2xx ilegible", () => () => jsonResponse(200, { ok: true })],
  ])("%s: pago incierto con recuperación y la tarjeta sin acciones", async (_name, responder) => {
    const ctx = setup();
    const request = received(ctx, 1_000);
    const { user } = await open("/solicitudes", ctx);
    ctx.backend.nextFor("POST", `/money-requests/${request.id}/accept`, responder());
    const name = "Solicitud te pide Valentina Gómez";
    await user.click(within(card(name)).getByRole("button", { name: "Aceptar y transferir" }));
    await user.click(within(card(name)).getByRole("button", { name: "Confirmar pago" }));
    const recovery = await screen.findByRole("region", { name: "Pago de solicitud sin confirmar" });
    expect(recovery).toHaveTextContent("No sabemos si se pagó la solicitud");
    expect(recovery).toHaveTextContent(request.id);
    expect(card(name)).toHaveTextContent("Pago sin confirmar: resuélvelo en el aviso de arriba.");
    expect(within(card(name)).queryByRole("button")).not.toBeInTheDocument();
    expect(accepts(ctx.backend, request.id)).toHaveLength(1);
  });

  it("timeout: el reintento manual usa la misma clave y, si ya se pagó, no cobra dos veces", async () => {
    const ctx = setup(500_000);
    const request = received(ctx, 1_000);
    const { user } = await open("/solicitudes", ctx, 50);
    ctx.backend.nextFor("POST", `/money-requests/${request.id}/accept`, async (incoming) => {
      await ctx.backend.fetchFn(`/api/money-requests/${request.id}/accept`, { method: "POST", headers: incoming.headers });
      return new Promise<Response>((_resolve, reject) => {
        incoming.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    const name = "Solicitud te pide Valentina Gómez";
    await user.click(within(card(name)).getByRole("button", { name: "Aceptar y transferir" }));
    await user.click(within(card(name)).getByRole("button", { name: "Confirmar pago" }));
    const recovery = await screen.findByRole("region", { name: "Pago de solicitud sin confirmar" });
    expect(ctx.me.balance).toBe(499_000);

    await user.click(within(recovery).getByRole("button", { name: "Reintentar con la misma clave" }));
    expect(await screen.findByText("Esta solicitud ya había sido pagada")).toBeInTheDocument();
    const [, original, retry] = accepts(ctx.backend, request.id);
    expect(keyOf(retry)).toBe(keyOf(original));
    expect(ctx.me.balance).toBe(499_000);
    expect(ctx.valentina.balance).toBe(51_000);
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Pago de solicitud sin confirmar" })).not.toBeInTheDocument();
    });
    expect(ctx.storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).toBeNull();
  });

  it("tras recargar la página se recupera el pago pendiente con la misma clave", async () => {
    const ctx = setup(500_000);
    const request = received(ctx, 1_000);
    const first = await open("/solicitudes", ctx);
    ctx.backend.nextFor("POST", `/money-requests/${request.id}/accept`, networkDown);
    const name = "Solicitud te pide Valentina Gómez";
    await first.user.click(within(card(name)).getByRole("button", { name: "Aceptar y transferir" }));
    await first.user.click(within(card(name)).getByRole("button", { name: "Confirmar pago" }));
    await screen.findByRole("region", { name: "Pago de solicitud sin confirmar" });
    first.unmount();

    const second = await open("/solicitudes", ctx);
    const recovery = await screen.findByRole("region", { name: "Pago de solicitud sin confirmar" });
    await second.user.click(within(recovery).getByRole("button", { name: "Reintentar con la misma clave" }));
    expect(await screen.findByText("Transacción completada")).toBeInTheDocument();
    const [a, b] = accepts(ctx.backend, request.id);
    expect(keyOf(b)).toBe(keyOf(a));
    expect(ctx.me.balance).toBe(499_000);
  });

  it("descartar el pago pendiente exige confirmación y no revierte nada", async () => {
    const ctx = setup();
    const request = received(ctx, 1_000);
    createIdempotencyManager({ store: ctx.storage.operations }).begin(acceptScope(ctx.me.id, request.id), { request_id: request.id });
    const { user } = await open("/solicitudes", ctx);
    const recovery = await screen.findByRole("region", { name: "Pago de solicitud sin confirmar" });
    await user.click(within(recovery).getByRole("button", { name: "Dejar de intentar recuperar" }));
    expect(screen.getByText("¿Dejar de intentar recuperar este pago?")).toBeInTheDocument();
    expect(screen.getByText(/no cancela ni/)).toBeInTheDocument();
    expect(ctx.storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Sí, dejar de intentar recuperar" }));
    await waitFor(() => {
      expect(ctx.storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).toBeNull();
    });
    expect(within(card("Solicitud te pide Valentina Gómez")).getByRole("button", { name: "Aceptar y transferir" })).toBeInTheDocument();
    expect(accepts(ctx.backend, request.id)).toHaveLength(0);
  });

  it("reintento con rechazo definitivo (saldo insuficiente) cierra la recuperación y lo explica", async () => {
    const ctx = setup(100);
    const request = received(ctx, 1_000);
    createIdempotencyManager({ store: ctx.storage.operations }).begin(acceptScope(ctx.me.id, request.id), { request_id: request.id });
    const { user } = await open("/solicitudes", ctx);
    const recovery = await screen.findByRole("region", { name: "Pago de solicitud sin confirmar" });
    await user.click(within(recovery).getByRole("button", { name: "Reintentar con la misma clave" }));
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Pago de solicitud sin confirmar" })).not.toBeInTheDocument();
    });
    expect(ctx.storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).toBeNull();
    expect(card("Solicitud te pide Valentina Gómez")).toHaveTextContent("Pendiente");
  });
});

describe("Solicitudes: rechazar y cancelar", () => {
  it("rechazar pide confirmación, no usa Idempotency-Key y no mueve dinero", async () => {
    const ctx = setup();
    const request = received(ctx, 5_000);
    const { user } = await open("/solicitudes", ctx);
    const name = "Solicitud te pide Valentina Gómez";
    await user.click(within(card(name)).getByRole("button", { name: "Rechazar" }));
    expect(within(card(name)).getByText("¿Rechazar esta solicitud?")).toBeInTheDocument();
    await user.click(within(card(name)).getByRole("button", { name: "Volver" }));
    expect(ctx.backend.requestsTo(`/money-requests/${request.id}/reject`)).toHaveLength(0);

    await user.click(within(card(name)).getByRole("button", { name: "Rechazar" }));
    await user.click(within(card(name)).getByRole("button", { name: "Sí, rechazar" }));
    expect(await screen.findByText("Solicitud rechazada")).toBeInTheDocument();
    const [post] = ctx.backend.requestsTo(`/money-requests/${request.id}/reject`, "POST");
    expect(post?.headers.get("Idempotency-Key")).toBeNull();
    expect(ctx.me.balance).toBe(500_000);
    expect(ctx.valentina.balance).toBe(50_000);
    await waitFor(() => {
      expect(card(name)).toHaveTextContent("Rechazada");
    });
    expect(within(card(name)).queryByRole("button")).not.toBeInTheDocument();
  });

  it("cancelar (solicitante) pide confirmación y actualiza la lista", async () => {
    const ctx = setup();
    const request = sent(ctx, 7_000);
    const { user } = await open("/solicitudes?rol=enviadas&estado=todas&pagina=1", ctx);
    const name = "Solicitud le pediste Valentina Gómez";
    await user.click(within(card(name)).getByRole("button", { name: "Cancelar solicitud" }));
    expect(within(card(name)).getByText("¿Cancelar esta solicitud?")).toBeInTheDocument();
    await user.click(within(card(name)).getByRole("button", { name: "Sí, cancelar solicitud" }));
    expect(await screen.findByText("Solicitud cancelada")).toBeInTheDocument();
    expect(ctx.backend.requestsTo(`/money-requests/${request.id}/cancel`, "POST")[0]?.headers.get("Idempotency-Key")).toBeNull();
    await waitFor(() => {
      expect(card(name)).toHaveTextContent("Cancelada");
    });
  });

  it("rechazar actualiza el contador de la barra lateral", async () => {
    const ctx = setup();
    received(ctx, 5_000);
    received(ctx, 6_000, "PENDING", 1);
    const { user } = await open("/solicitudes", ctx);
    await waitFor(() => {
      expect(badge()).toHaveTextContent("2");
    });
    const [first] = cards();
    await user.click(within(first as HTMLElement).getByRole("button", { name: "Rechazar" }));
    await user.click(within(first as HTMLElement).getByRole("button", { name: "Sí, rechazar" }));
    await screen.findByText("Solicitud rechazada");
    await waitFor(() => {
      expect(badge()).toHaveTextContent("1");
    });
  });

  it("409 al rechazar algo ya resuelto: avisa y recarga", async () => {
    const ctx = setup();
    const request = received(ctx, 5_000);
    const { user } = await open("/solicitudes", ctx);
    request.status = "CANCELLED";
    request.resolved_at = "2026-11-12T12:00:00Z";
    const name = "Solicitud te pide Valentina Gómez";
    await user.click(within(card(name)).getByRole("button", { name: "Rechazar" }));
    await user.click(within(card(name)).getByRole("button", { name: "Sí, rechazar" }));
    expect(await screen.findAllByText("La solicitud ya no está pendiente")).toHaveLength(2); // en la tarjeta y en el aviso de la página
    await waitFor(() => {
      expect(card(name)).toHaveTextContent("Cancelada");
    });
  });

  it("error de red al rechazar: no reintenta, consulta el estado real (se completó)", async () => {
    const ctx = setup();
    const request = received(ctx, 5_000);
    const { user } = await open("/solicitudes", ctx);
    ctx.backend.nextFor("POST", `/money-requests/${request.id}/reject`, async (incoming) => {
      await ctx.backend.fetchFn(`/api/money-requests/${request.id}/reject`, { method: "POST", headers: incoming.headers });
      throw new TypeError("Failed to fetch");
    });
    const name = "Solicitud te pide Valentina Gómez";
    await user.click(within(card(name)).getByRole("button", { name: "Rechazar" }));
    await user.click(within(card(name)).getByRole("button", { name: "Sí, rechazar" }));
    expect(await screen.findByText("Solicitud rechazada")).toBeInTheDocument();
    expect(ctx.backend.requestsTo(`/money-requests/${request.id}/reject`, "POST")).toHaveLength(2);
    expect(ctx.backend.requestsTo(`/money-requests/${request.id}`, "GET")).toHaveLength(1);
  });

  it("error de red al cancelar y sigue pendiente: lo dice sin reintentar", async () => {
    const ctx = setup();
    const request = sent(ctx, 5_000);
    const { user } = await open("/solicitudes?rol=enviadas&estado=todas&pagina=1", ctx);
    ctx.backend.nextFor("POST", `/money-requests/${request.id}/cancel`, networkDown);
    const name = "Solicitud le pediste Valentina Gómez";
    await user.click(within(card(name)).getByRole("button", { name: "Cancelar solicitud" }));
    await user.click(within(card(name)).getByRole("button", { name: "Sí, cancelar solicitud" }));
    expect(await within(card(name)).findByText("La acción no se completó")).toBeInTheDocument();
    expect(ctx.backend.requestsTo(`/money-requests/${request.id}/cancel`, "POST")).toHaveLength(1);
    expect(within(card(name)).getByRole("button", { name: "Cancelar solicitud" })).toBeInTheDocument();
  });

  it("sin red para comprobar: «No sabemos si la acción se completó» y «Comprobar estado»", async () => {
    const ctx = setup();
    const request = received(ctx, 5_000);
    const { user } = await open("/solicitudes", ctx);
    ctx.backend.nextFor("POST", `/money-requests/${request.id}/reject`, networkDown);
    ctx.backend.nextFor("GET", `/money-requests/${request.id}`, networkDown);
    const name = "Solicitud te pide Valentina Gómez";
    await user.click(within(card(name)).getByRole("button", { name: "Rechazar" }));
    await user.click(within(card(name)).getByRole("button", { name: "Sí, rechazar" }));
    expect(await within(card(name)).findByText("No sabemos si la acción se completó")).toBeInTheDocument();
    await user.click(within(card(name)).getByRole("button", { name: "Comprobar estado" }));
    expect(await within(card(name)).findByText("La acción no se completó")).toBeInTheDocument();
    expect(ctx.backend.requestsTo(`/money-requests/${request.id}/reject`, "POST")).toHaveLength(1);
  });

  it("permisos por papel: el pagador no puede cancelar y el solicitante no puede aceptar ni rechazar", async () => {
    const ctx = setup();
    received(ctx, 1_000);
    sent(ctx, 2_000, "PENDING", 1);
    const { user } = await open("/solicitudes", ctx);
    const incoming = card("Solicitud te pide Valentina Gómez");
    expect(within(incoming).queryByRole("button", { name: "Cancelar solicitud" })).not.toBeInTheDocument();
    await user.click(tab(/Enviadas/));
    await waitFor(() => {
      expect(card("Solicitud le pediste Valentina Gómez")).toBeInTheDocument();
    });
    const outgoing = card("Solicitud le pediste Valentina Gómez");
    expect(within(outgoing).queryByRole("button", { name: "Aceptar y transferir" })).not.toBeInTheDocument();
    expect(within(outgoing).queryByRole("button", { name: "Rechazar" })).not.toBeInTheDocument();
  });

  it("el backend falso aplica los mismos permisos (404 sin participar o con otro papel)", async () => {
    const ctx = setup();
    const theirs = moneyRequest(party(ctx.valentina), party(ctx.mateo), 1_000, "PENDING", at(0));
    ctx.backend.addMoneyRequest(theirs);
    const mine = sent(ctx, 1_000);
    const call = (path: string) =>
      ctx.backend.fetchFn(`/api${path}`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } });
    expect((await call(`/money-requests/${theirs.id}/reject`)).status).toBe(404);
    expect((await call(`/money-requests/${mine.id}/reject`)).status).toBe(404);
    expect(
      (await ctx.backend.fetchFn(`/api/money-requests/${mine.id}/accept`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Idempotency-Key": "k-1" },
      })).status,
    ).toBe(404);
    expect((await call(`/money-requests/${mine.id}/cancel`)).status).toBe(200);
    expect((await call(`/money-requests/${mine.id}/cancel`)).status).toBe(409);
  });
});

describe("Solicitudes: sesión y credenciales", () => {
  it("401: la sesión termina y lleva a «Acceder»", async () => {
    const ctx = setup();
    received(ctx, 1_000);
    const { user } = await open("/solicitudes", ctx);
    ctx.backend.accounts.delete(TOKEN);
    const name = "Solicitud te pide Valentina Gómez";
    await user.click(within(card(name)).getByRole("button", { name: "Rechazar" }));
    await user.click(within(card(name)).getByRole("button", { name: "Sí, rechazar" }));
    expect(await screen.findByText("Tu sesión terminó")).toBeInTheDocument();
    expect(ctx.storage.session.get(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("al cambiar de cuenta no quedan solicitudes ni operaciones de la anterior", async () => {
    const ctx = setup();
    received(ctx, 1_000, "PENDING", 0, "Secreto de Camilo");
    createIdempotencyManager({ store: ctx.storage.operations }).begin(createScope(ctx.me.id), {
      payer_account_id: ctx.valentina.id,
      amount: 9_999,
    });
    const { user } = await open("/solicitudes", ctx);
    expect(screen.getByText("Secreto de Camilo")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByText(/Cerraste sesión/)).toBeInTheDocument();
    expect(screen.queryByText("Secreto de Camilo")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Ya tengo cuenta" }));
    await user.type(screen.getByLabelText(/bearer token de acceso/i), OTHER_TOKEN);
    await user.click(screen.getByRole("button", { name: "Acceder a mi cuenta" }));
    await screen.findByText("Valentina Gómez");
    await user.click(within(screen.getByRole("navigation", { name: "Navegación principal" })).getByRole("link", { name: /Solicitudes/ }));
    await screen.findByRole("heading", { level: 1, name: "Solicitudes de dinero" });
    expect(screen.queryByText("Secreto de Camilo")).not.toBeInTheDocument();
    expect(screen.queryByText("No sabemos si la solicitud se creó")).not.toBeInTheDocument();
    expect(screen.queryByText(/Hay una solicitud de esta sesión/)).not.toBeInTheDocument();
  });

  it("el token no aparece en URL, cuerpo, clave, datos guardados, DOM ni consola", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const ctx = setup();
    const request = received(ctx, 1_000);
    const { user } = await open("/solicitudes", ctx);
    ctx.backend.nextFor("POST", `/money-requests/${request.id}/accept`, networkDown);
    const name = "Solicitud te pide Valentina Gómez";
    await user.click(within(card(name)).getByRole("button", { name: "Aceptar y transferir" }));
    await user.click(within(card(name)).getByRole("button", { name: "Confirmar pago" }));
    await screen.findByRole("region", { name: "Pago de solicitud sin confirmar" });

    for (const sentRequest of ctx.backend.requests) {
      expect(sentRequest.url).not.toContain(TOKEN);
      expect(sentRequest.body ?? "").not.toContain(TOKEN);
      expect(keyOf(sentRequest) ?? "").not.toContain(TOKEN);
    }
    expect(ctx.storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(location()).not.toContain(TOKEN);
    for (const spy of spies) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(TOKEN);
  });
});

describe("Inicio: enlace a Solicitudes", () => {
  it("una recibida pendiente ofrece «Responder en Solicitudes»; las enviadas no", async () => {
    const ctx = setup();
    received(ctx, 1_000);
    sent(ctx, 2_000, "PENDING", 1);
    const { user } = renderApp({ path: "/", backend: ctx.backend, storage: ctx.storage });
    const links = await screen.findAllByRole("link", { name: "Responder en Solicitudes" });
    expect(links).toHaveLength(1);
    expect(within(screen.getByRole("article", { name: "Solicitud le pediste Valentina Gómez" })).queryByRole("link")).not.toBeInTheDocument();
    await user.click(links[0] as HTMLElement);
    expect(location()).toBe("/solicitudes?rol=recibidas&estado=pendientes&pagina=1");
    await screen.findByRole("heading", { level: 1, name: "Solicitudes de dinero" });
  });
});
