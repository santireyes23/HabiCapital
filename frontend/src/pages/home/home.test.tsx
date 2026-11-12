import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TOKEN_STORAGE_KEY } from "../../session/tokenStore";
import { deferred, fakeBackend, networkDown } from "../../test/fakeBackend";
import { moneyRequest, movement } from "../../test/fixtures";
import { jsonResponse } from "../../test/http";
import { newTabStorage, renderApp } from "../../test/renderApp";

const TOKEN = "homeTok_Zx9abcDEF123ghiJKL456mnoPQR789stuVW";

function setup(balance = 2_450_000) {
  const backend = fakeBackend();
  const account = backend.addAccount(TOKEN, "Camilo Aristizábal", balance);
  const storage = newTabStorage();
  storage.session.set(TOKEN_STORAGE_KEY, TOKEN);
  return { backend, account, storage };
}

const OTHER = { account_id: "4f9b2d8e-17c3-4d62-a58f-90e8c71b3e21", owner_name: "Valentina Gómez" };
const THIRD = { account_id: "73e02f18-d9a4-47c1-b631-f190bc74a389", owner_name: "Mateo Restrepo" };

describe("Inicio: saldo", () => {
  it("muestra el saldo que devuelve GET /accounts/me al entrar (no el de la sesión)", async () => {
    const { backend, account, storage } = setup(100);
    const { user } = renderApp({ path: "/", backend, storage });
    await screen.findByText("Camilo Aristizábal");

    // El saldo cambia en el servidor; al volver a Inicio se vuelve a leer.
    account.balance = 2_450_000;
    await user.click(within(screen.getByRole("navigation", { name: "Navegación principal" })).getByRole("link", { name: "Movimientos" }));
    await user.click(within(screen.getByRole("navigation", { name: "Navegación principal" })).getByRole("link", { name: "Inicio" }));

    const card = await screen.findByRole("article", { name: "Saldo total disponible" });
    await waitFor(() => {
      expect(card).toHaveTextContent("$2.450.000COP");
    });
    expect(backend.requestsTo("/accounts/me").length).toBeGreaterThanOrEqual(2);
  });

  it("si no puede actualizar el saldo lo dice y permite reintentar", async () => {
    const { backend, storage } = setup(5_000);
    const { user } = renderApp({ path: "/movimientos", backend, storage });
    await screen.findByText("Camilo Aristizábal");
    backend.nextFor("GET", "/accounts/me", networkDown);

    await user.click(within(screen.getByRole("navigation", { name: "Navegación principal" })).getByRole("link", { name: "Inicio" }));

    const alert = await screen.findByText("No se pudo actualizar el saldo");
    await user.click(within(alert.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => {
      expect(screen.queryByText("No se pudo actualizar el saldo")).not.toBeInTheDocument();
    });
  });

  it("no incluye la franja «Enviado/Recibido este mes» y enlaza a Enviar y Recargar", async () => {
    const { backend, storage } = setup();
    renderApp({ path: "/", backend, storage });
    await screen.findByText("Camilo Aristizábal");
    expect(screen.queryByText(/este mes/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Enviar dinero.*Transferencia simulada/ })).toHaveAttribute("href", "/enviar");
    expect(screen.getByRole("link", { name: /Recargar saldo simulado/ })).toHaveAttribute("href", "/recargar");
  });
});

describe("Inicio: movimientos recientes", () => {
  it("muestra solo los 4 más recientes con tipo, signo y contraparte reales", async () => {
    const { backend, account, storage } = setup();
    backend.addMovement(account.id, movement("DEPOSIT", 500_000, "2026-11-12T15:45:00Z", { description: "Recarga inicial" }));
    backend.addMovement(account.id, movement("TRANSFER_SENT", 135_000, "2026-11-12T13:30:00Z", { counterparty: OTHER, description: "Pago cena" }));
    backend.addMovement(account.id, movement("TRANSFER_RECEIVED", 80_000, "2026-11-11T23:15:00Z", { counterparty: THIRD }));
    backend.addMovement(account.id, movement("TRANSFER_SENT", 210_000, "2026-11-10T18:20:00Z", { counterparty: THIRD }));
    backend.addMovement(account.id, movement("DEPOSIT", 1_000, "2026-11-01T10:00:00Z"));
    renderApp({ path: "/", backend, storage });

    const list = await screen.findByRole("list", { name: "Últimos movimientos" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("Recarga de saldo simulada");
    expect(rows[0]).toHaveTextContent("Recarga interna");
    expect(rows[0]).toHaveTextContent("+$500.000 COP");
    expect(rows[1]).toHaveTextContent("Valentina Gómez");
    expect(rows[1]).toHaveTextContent("4f9b...3e21 · Pago cena");
    expect(rows[1]).toHaveTextContent("Transferencia enviada");
    expect(rows[1]).toHaveTextContent("-$135.000 COP");
    expect(rows[2]).toHaveTextContent("Transferencia recibida");
    expect(rows[2]).toHaveTextContent("+$80.000 COP");
    expect(screen.getByText(/4 movimientos cargados desde la base de datos \(de 5 en total\)/)).toBeInTheDocument();

    const request = backend.requestsTo("/accounts/me/movements")[0];
    expect(request?.url).toContain("limit=4&offset=0&order=desc");
  });

  it("estado vacío con enlace a Recargar", async () => {
    const { backend, storage } = setup();
    renderApp({ path: "/", backend, storage });
    const empty = await screen.findByText("Aún no tienes movimientos");
    const section = empty.closest("section") as HTMLElement;
    expect(within(section).getByRole("link", { name: "Recargar saldo" })).toHaveAttribute("href", "/recargar");
  });

  it("error con el mensaje real y «Reintentar»; «Actualizar» trae movimientos nuevos", async () => {
    const { backend, account, storage } = setup();
    backend.nextFor("GET", "/accounts/me/movements", () => jsonResponse(503, { detail: "Servicio no disponible" }));
    const { user } = renderApp({ path: "/", backend, storage });

    const error = await screen.findByText("No se pudieron cargar los movimientos");
    expect(error.closest("[role=alert]")).toHaveTextContent("Servicio no disponible");
    await user.click(within(error.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Aún no tienes movimientos")).toBeInTheDocument();

    backend.addMovement(account.id, movement("DEPOSIT", 50_000, "2026-11-12T16:00:00Z"));
    await user.click(screen.getByRole("button", { name: "Actualizar" }));
    expect(await screen.findByText("+$50.000 COP")).toBeInTheDocument();
  });

  it("muestra un estado de carga mientras espera a FastAPI", async () => {
    const { backend, storage } = setup();
    const pending = deferred();
    backend.nextFor("GET", "/accounts/me/movements", pending.responder);
    renderApp({ path: "/", backend, storage });
    expect(await screen.findByLabelText("Cargando movimientos")).toBeInTheDocument();
    pending.release(jsonResponse(200, { items: [], total: 0, limit: 4, offset: 0, order: "desc" }));
    expect(await screen.findByText("Aún no tienes movimientos")).toBeInTheDocument();
  });
});

describe("Inicio: solicitudes (solo consulta)", () => {
  function withRequests() {
    const ctx = setup();
    const me = { account_id: ctx.account.id, owner_name: ctx.account.owner_name };
    ctx.backend.addMoneyRequest(moneyRequest(OTHER, me, 42_500, "PENDING", "2026-11-12T14:35:00Z", "Almuerzo"));
    ctx.backend.addMoneyRequest(moneyRequest(me, THIRD, 68_000, "ACCEPTED", "2026-11-12T13:14:00Z", "Cuota internet"));
    ctx.backend.addMoneyRequest(moneyRequest(THIRD, me, 95_000, "REJECTED", "2026-11-11T19:30:00Z", "Boleta"));
    return ctx;
  }

  it("cuenta enviadas y recibidas con los totales reales y las ordena por fecha", async () => {
    const { backend, storage } = withRequests();
    renderApp({ path: "/", backend, storage });

    expect(await screen.findByText("3 registradas")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Todas (3)" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Recibidas (2)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Enviadas (1)" })).toBeInTheDocument();

    const section = screen.getByRole("region", { name: "Solicitudes de dinero" });
    const cards = within(section).getAllByRole("article");
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      "Solicitud te pide Valentina Gómez",
      "Solicitud le pediste Mateo Restrepo",
      "Solicitud te pide Mateo Restrepo",
    ]);
    const urls = backend.requestsTo("/money-requests").map((r) => r.url);
    expect(urls).toContain("/api/money-requests?role=received&limit=4&order=desc");
    expect(urls).toContain("/api/money-requests?role=sent&limit=4&order=desc");
  });

  it("los textos y el signo dependen de quién pidió y quién paga", async () => {
    const { backend, storage } = withRequests();
    renderApp({ path: "/", backend, storage });
    const accepted = await screen.findByRole("article", { name: "Solicitud le pediste Mateo Restrepo" });
    expect(accepted).toHaveTextContent("Monto acreditado");
    expect(accepted).toHaveTextContent("+$68.000 COP");
    expect(accepted).toHaveTextContent("Acreditado a tu saldo");
    const rejected = screen.getByRole("article", { name: "Solicitud te pide Mateo Restrepo" });
    expect(rejected).toHaveTextContent("Rechazaste esta solicitud");
    expect(rejected).toHaveTextContent("$95.000 COP");
  });

  it("las pestañas filtran y no hay botones de aceptar, rechazar ni cancelar", async () => {
    const { backend, storage } = withRequests();
    const { user } = renderApp({ path: "/", backend, storage });
    await screen.findByText("3 registradas");

    await user.click(screen.getByRole("tab", { name: "Enviadas (1)" }));
    const section = screen.getByRole("region", { name: "Solicitudes de dinero" });
    expect(within(section).getAllByRole("article")).toHaveLength(1);
    expect(within(section).queryByRole("button", { name: /aceptar|rechazar|cancelar/i })).not.toBeInTheDocument();
  });

  it("estado vacío y error con reintento", async () => {
    const { backend, storage } = setup();
    backend.nextFor("GET", "/money-requests", networkDown);
    const { user } = renderApp({ path: "/", backend, storage });
    const error = await screen.findByText("No se pudieron cargar las solicitudes");
    await user.click(within(error.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Aún no tienes solicitudes")).toBeInTheDocument();
  });

  it("la barra lateral muestra cuántas solicitudes recibidas siguen pendientes", async () => {
    const { backend, account, storage } = setup();
    const me = { account_id: account.id, owner_name: account.owner_name };
    backend.addMoneyRequest(moneyRequest(OTHER, me, 1_000, "PENDING", "2026-11-12T10:00:00Z"));
    backend.addMoneyRequest(moneyRequest(THIRD, me, 2_000, "PENDING", "2026-11-12T11:00:00Z"));
    backend.addMoneyRequest(moneyRequest(THIRD, me, 3_000, "REJECTED", "2026-11-12T12:00:00Z"));
    backend.addMoneyRequest(moneyRequest(me, OTHER, 4_000, "PENDING", "2026-11-12T13:00:00Z"));
    renderApp({ path: "/", backend, storage });

    expect(await screen.findByLabelText("2 solicitudes recibidas pendientes")).toHaveTextContent("2");
    expect(backend.requestsTo("/money-requests").some((r) => r.url.includes("role=received&status=PENDING&limit=1"))).toBe(true);
  });

  it("sin pendientes no hay contador", async () => {
    const { backend, storage } = setup();
    renderApp({ path: "/", backend, storage });
    await screen.findByText("Aún no tienes solicitudes");
    expect(screen.queryByLabelText(/solicitudes recibidas pendientes/)).not.toBeInTheDocument();
  });
});
