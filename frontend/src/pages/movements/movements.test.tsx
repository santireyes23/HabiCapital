import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TOKEN_STORAGE_KEY } from "../../session/tokenStore";
import { deferred, fakeBackend, networkDown } from "../../test/fakeBackend";
import { movement } from "../../test/fixtures";
import { formatDateTime } from "../../lib/dates";
import { jsonResponse } from "../../test/http";
import { newTabStorage, renderApp } from "../../test/renderApp";

const TOKEN = "movTok_Zx9abcDEF123ghiJKL456mnoPQR789stuVWx";
const ANA = { account_id: "4f9b2d8e-17c3-4d62-a58f-90e8c71b3e21", owner_name: "Ana Gómez" };

/** n recargas con fechas crecientes (la 1 es la más antigua). */
function setup(count = 0, balance = 750_000) {
  const backend = fakeBackend();
  const account = backend.addAccount(TOKEN, "Camilo Aristizábal", balance);
  for (let index = 1; index <= count; index += 1) {
    const minute = String(index % 60).padStart(2, "0");
    const hour = String(10 + Math.floor(index / 60)).padStart(2, "0");
    backend.addMovement(
      account.id,
      movement("DEPOSIT", index * 1_000, `2026-11-12T${hour}:${minute}:00Z`, { description: `Recarga ${index}` }),
    );
  }
  const storage = newTabStorage();
  storage.session.set(TOKEN_STORAGE_KEY, TOKEN);
  return { backend, account, storage };
}

async function open(path: string, ctx = setup(12)) {
  const view = renderApp({ path, backend: ctx.backend, storage: ctx.storage });
  await screen.findByRole("heading", { level: 1, name: "Mis movimientos" });
  return { ...ctx, ...view };
}

const rows = () => within(screen.getByRole("list", { name: "Movimientos" })).getAllByRole("listitem");
const location = () => screen.getByTestId("location").textContent;
const movementRequests = (backend: ReturnType<typeof fakeBackend>) =>
  backend.requestsTo("/accounts/me/movements").map((request) => request.url);

describe("Movimientos: historial real", () => {
  it("muestra recargas, enviadas y recibidas con signo, contraparte y hora de Bogotá", async () => {
    const ctx = setup();
    ctx.backend.addMovement(ctx.account.id, movement("DEPOSIT", 500_000, "2026-11-12T15:45:00Z"));
    ctx.backend.addMovement(
      ctx.account.id,
      movement("TRANSFER_SENT", 135_000, "2026-11-12T13:30:00Z", { counterparty: ANA, description: "Cena" }),
    );
    ctx.backend.addMovement(
      ctx.account.id,
      movement("TRANSFER_RECEIVED", 80_000, "2026-11-11T23:15:00Z", { counterparty: ANA }),
    );
    await open("/movimientos", ctx);

    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    const [deposit, sent, received] = rows();
    expect(deposit).toHaveTextContent("Recarga simulada");
    expect(deposit).toHaveTextContent("Acreditación directa");
    expect(deposit).toHaveTextContent("Sistema HabiCapital");
    expect(deposit).toHaveTextContent("+$500.000 COP");
    expect(sent).toHaveTextContent("Transferencia enviada");
    expect(sent).toHaveTextContent("Débito entre cuentas");
    expect(sent).toHaveTextContent("Ana Gómez");
    expect(sent).toHaveTextContent("UUID: 4f9b...3e21");
    expect(sent).toHaveTextContent("-$135.000 COP");
    expect(received).toHaveTextContent("Transferencia recibida");
    expect(received).toHaveTextContent("+$80.000 COP");
    expect(received).toHaveTextContent(formatDateTime("2026-11-11T23:15:00Z"));
    expect(formatDateTime("2026-11-11T23:15:00Z")).toMatch(/06:15 PM$/);
    expect(screen.getByText("Saldo disponible").parentElement).toHaveTextContent("$750.000 COP");
    expect(movementRequests(ctx.backend)[0]).toBe("/api/accounts/me/movements?limit=10&offset=0&order=desc");
  });

  it("estado vacío con acción para Recargar saldo", async () => {
    await open("/movimientos", setup(0));
    expect(await screen.findByText("Aún no tienes movimientos")).toBeInTheDocument();
    const empty = screen.getByText("Aún no tienes movimientos").closest("div.rounded-card") as HTMLElement;
    expect(within(empty).getByRole("link", { name: "Recargar saldo" })).toHaveAttribute("href", "/recargar");
  });

  it("estado de carga con el estilo del diseño", async () => {
    const ctx = setup(3);
    const pending = deferred();
    ctx.backend.nextFor("GET", "/accounts/me/movements", pending.responder);
    renderApp({ path: "/movimientos", backend: ctx.backend, storage: ctx.storage });
    expect(await screen.findByLabelText("Cargando movimientos")).toBeInTheDocument();
    pending.release(jsonResponse(200, { items: [], total: 0, limit: 10, offset: 0, order: "desc" }));
    expect(await screen.findByText("Aún no tienes movimientos")).toBeInTheDocument();
  });

  it("error con el mensaje real y «Reintentar»", async () => {
    const ctx = setup(2);
    ctx.backend.nextFor("GET", "/accounts/me/movements", networkDown);
    const { user } = await open("/movimientos", ctx);
    const error = await screen.findByText("No se pudo cargar el historial");
    expect(error.closest("[role=alert]")).toHaveTextContent("No se pudo conectar con el servidor de HabiCapital.");
    await user.click(within(error.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
  });

  it("«Actualizar historial» vuelve a consultar y muestra lo nuevo", async () => {
    const ctx = setup(1);
    const { user } = await open("/movimientos", ctx);
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    ctx.backend.addMovement(ctx.account.id, movement("DEPOSIT", 9_000, "2026-11-12T20:00:00Z"));
    await user.click(screen.getByRole("button", { name: "Actualizar historial" }));
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(rows()[0]).toHaveTextContent("+$9.000 COP");
  });
});

describe("Movimientos: orden, tamaño de página y paginación", () => {
  it("orden descendente por defecto y ascendente al cambiarlo (vuelve a la página 1)", async () => {
    const { user, backend } = await open("/movimientos?pagina=2");
    await waitFor(() => {
      expect(rows()[0]).toHaveTextContent("+$2.000 COP");
    });
    await user.selectOptions(screen.getByLabelText("Ordenar por:"), "asc");
    await waitFor(() => {
      expect(rows()[0]).toHaveTextContent("+$1.000 COP");
    });
    expect(location()).toBe("/movimientos?orden=antiguos&limite=10&pagina=1");
    expect(movementRequests(backend).at(-1)).toBe("/api/accounts/me/movements?limit=10&offset=0&order=asc");
  });

  it("cambia el tamaño de página a 20 y 50 (dentro del tope de la API)", async () => {
    const { user, backend } = await open("/movimientos");
    await waitFor(() => {
      expect(rows()).toHaveLength(10);
    });
    await user.selectOptions(screen.getByLabelText("Mostrar:"), "20");
    await waitFor(() => {
      expect(rows()).toHaveLength(12);
    });
    expect(location()).toBe("/movimientos?orden=recientes&limite=20&pagina=1");
    await user.selectOptions(screen.getByLabelText("Mostrar:"), "50");
    expect(movementRequests(backend).at(-1)).toContain("limit=50&offset=0");
    expect(screen.getByLabelText("Mostrar:").querySelectorAll("option")).toHaveLength(3);
  });

  it("pagina con limit/offset, «Anterior», «Siguiente», números y contador", async () => {
    const { user, backend } = await open("/movimientos");
    await waitFor(() => {
      expect(rows()).toHaveLength(10);
    });
    expect(screen.getByText(/Mostrando/).textContent).toBe("Mostrando 1 - 10 de 12 movimientos");
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Página 1" })).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(screen.getByText(/Mostrando/).textContent).toBe("Mostrando 11 - 12 de 12 movimientos");
    expect(location()).toBe("/movimientos?orden=recientes&limite=10&pagina=2");
    expect(movementRequests(backend).at(-1)).toBe("/api/accounts/me/movements?limit=10&offset=10&order=desc");
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Página 1" }));
    await waitFor(() => {
      expect(rows()).toHaveLength(10);
    });
  });

  it("los parámetros de la URL se leen al entrar", async () => {
    const { backend } = await open("/movimientos?orden=antiguos&limite=20&pagina=1");
    await waitFor(() => {
      expect(rows()).toHaveLength(12);
    });
    expect(movementRequests(backend)[0]).toBe("/api/accounts/me/movements?limit=20&offset=0&order=asc");
    expect(screen.getByLabelText("Ordenar por:")).toHaveValue("asc");
    expect(screen.getByLabelText("Mostrar:")).toHaveValue("20");
  });

  it("valores inválidos en la URL se reemplazan por válidos", async () => {
    await open("/movimientos?orden=x&limite=999&pagina=-4");
    await waitFor(() => {
      expect(location()).toBe("/movimientos?orden=recientes&limite=10&pagina=1");
    });
  });

  it("una página fuera de rango lleva a la última válida", async () => {
    const { backend } = await open("/movimientos?pagina=9");
    await waitFor(() => {
      expect(location()).toBe("/movimientos?orden=recientes&limite=10&pagina=2");
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(movementRequests(backend).at(-1)).toContain("offset=10");
  });
});

describe("Movimientos: detalle", () => {
  it("despliega solo datos de la respuesta: transacción, tipo, fecha, monto, saldo, descripción y contraparte", async () => {
    const ctx = setup();
    const sent = movement("TRANSFER_SENT", 135_000, "2026-11-12T13:30:00Z", {
      counterparty: ANA,
      description: "Cena",
      balanceAfter: 615_000,
    });
    ctx.backend.addMovement(ctx.account.id, sent);
    const { user } = await open("/movimientos", ctx);
    const toggle = await screen.findByRole("button", { name: /Ver detalle de transferencia enviada/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const detail = document.getElementById(toggle.getAttribute("aria-controls") ?? "") as HTMLElement;
    expect(detail).toHaveTextContent(sent.transaction_id);
    expect(detail).toHaveTextContent("Tipo de operaciónTransferencia enviada");
    expect(detail).toHaveTextContent(`Fecha y hora${formatDateTime(sent.created_at)}`);
    expect(detail).toHaveTextContent("Monto-$135.000 COP");
    expect(detail).toHaveTextContent("Saldo después del movimiento$615.000 COP");
    expect(detail).toHaveTextContent("DescripciónCena");
    expect(detail).toHaveTextContent(`Enviado aAna Gómez${ANA.account_id}`);

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(toggle.getAttribute("aria-controls") ?? "")).toBeNull();
  });

  it("una recarga sin descripción no muestra campos vacíos", async () => {
    const ctx = setup();
    ctx.backend.addMovement(ctx.account.id, movement("DEPOSIT", 1_000, "2026-11-12T13:30:00Z", { balanceAfter: 1_000 }));
    const { user } = await open("/movimientos", ctx);
    await user.click(await screen.findByRole("button", { name: /Ver detalle de recarga simulada/ }));
    expect(screen.queryByText("Descripción")).not.toBeInTheDocument();
    expect(screen.queryByText(/Enviado a|Recibido de/)).not.toBeInTheDocument();
  });
});

describe("Movimientos: presentación y seguridad", () => {
  it("tiene la versión de tabla (escritorio) y la de tarjetas (móvil) del mismo dato", async () => {
    await open("/movimientos", setup(1));
    const row = (await screen.findAllByRole("listitem"))[0] as HTMLElement;
    const amounts = within(row).getAllByText("+$1.000 COP");
    expect(amounts).toHaveLength(2);
    expect(amounts.some((node) => node.className.includes("md:hidden"))).toBe(true);
    expect(amounts.some((node) => node.className.includes("md:block"))).toBe(true);
    expect(within(row).getByText("Ver detalle")).toHaveClass("md:hidden");
  });

  it("tras cerrar sesión no queda ningún movimiento a la vista y otra cuenta no ve los anteriores", async () => {
    const ctx = setup(3);
    const OTHER = "otherMov_Qw7ertyUIOP456asdfGHJ789zxcvBNm";
    ctx.backend.addAccount(OTHER, "Otra Cuenta", 0);
    const { user } = await open("/movimientos", ctx);
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByText(/Cerraste sesión/)).toBeInTheDocument();
    expect(screen.queryByText("Recarga simulada")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Ya tengo cuenta" }));

    await user.type(screen.getByLabelText(/bearer token de acceso/i), OTHER);
    await user.click(screen.getByRole("button", { name: "Acceder a mi cuenta" }));
    await screen.findByText("Otra Cuenta");
    await user.click(within(screen.getByRole("navigation", { name: "Navegación principal" })).getByRole("link", { name: "Movimientos" }));
    expect(await screen.findByText("Aún no tienes movimientos")).toBeInTheDocument();
    expect(screen.queryByText("+$1.000 COP")).not.toBeInTheDocument();
  });

  it("el token va solo en la cabecera: nunca en la URL, el DOM ni la consola", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const { user, backend } = await open("/movimientos");
    await waitFor(() => {
      expect(rows()).toHaveLength(10);
    });
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.click((await screen.findAllByRole("button", { name: /Ver detalle/ }))[0] as HTMLElement);
    for (const request of backend.requestsTo("/accounts/me/movements")) {
      expect(request.url).not.toContain(TOKEN);
      expect(request.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    }
    expect(location()).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
    for (const spy of spies) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(TOKEN);
  });
});
