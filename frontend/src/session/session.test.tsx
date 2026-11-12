import { act, render, screen, within } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import { createApiClient } from "../api/client";
import { createEndpoints } from "../api/endpoints";
import { createIdempotencyManager, operationScope } from "../api/idempotency";
import { memoryStore } from "../lib/safeStorage";
import { fakeBackend, networkDown } from "../test/fakeBackend";
import { jsonResponse } from "../test/http";
import { locations, newTabStorage, renderApp } from "../test/renderApp";
import { createTokenStore, TOKEN_STORAGE_KEY } from "./tokenStore";

const TOKEN = "sessTok_Zx9abcDEF123ghiJKL456mnoPQR789stuVW";

function storageWithToken() {
  const storage = newTabStorage();
  storage.session.set(TOKEN_STORAGE_KEY, TOKEN);
  return storage;
}

describe("sesión al recargar", () => {
  it("200: valida el token guardado y abre el panel", async () => {
    const backend = fakeBackend();
    const account = backend.addAccount(TOKEN, "Valentina Gómez");
    renderApp({ path: "/", backend, storage: storageWithToken() });

    expect(screen.getByText("Verificando tu sesión con el servidor…")).toBeInTheDocument();
    expect(await screen.findByText("Valentina Gómez")).toBeInTheDocument();
    expect(screen.getAllByText(`Cuenta: ${account.id.slice(0, 4)}...${account.id.slice(-4)}`)).not.toHaveLength(0);
  });

  it("401: borra el token y lleva a «Acceder» con un aviso", async () => {
    const storage = storageWithToken();
    renderApp({ path: "/recargar", storage });

    expect(await screen.findByText("Tu sesión terminó")).toBeInTheDocument();
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/acceso/);
  });

  it("fallo de red: conserva el token, permite reintentar y no muestra datos privados", async () => {
    const backend = fakeBackend();
    backend.addAccount(TOKEN, "Valentina Gómez");
    backend.next(networkDown);
    const storage = storageWithToken();
    const { user } = renderApp({ path: "/", backend, storage });

    expect(await screen.findByText("No pudimos validar tu sesión")).toBeInTheDocument();
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBe(TOKEN);
    expect(screen.queryByText("Valentina Gómez")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Valentina Gómez")).toBeInTheDocument();
  });

  it("un error 5xx al validar tampoco cierra la sesión", async () => {
    const backend = fakeBackend();
    backend.next(() => jsonResponse(503, { detail: "Servicio no disponible" }));
    const storage = storageWithToken();
    renderApp({ path: "/", backend, storage });

    expect(await screen.findByText("No pudimos validar tu sesión")).toBeInTheDocument();
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBe(TOKEN);
  });
});

describe("cerrar sesión (local)", () => {
  it("borra token, aviso y operaciones pendientes de esa cuenta; no llama a ningún logout", async () => {
    const backend = fakeBackend();
    const account = backend.addAccount(TOKEN, "Valentina Gómez");
    const storage = storageWithToken();
    const pending = createIdempotencyManager({ store: storage.operations });
    pending.begin(operationScope(account.id, "transfer"), { amount: 1 });
    pending.begin(operationScope("otra-cuenta", "deposit"), { amount: 2 });
    const { user } = renderApp({ path: "/", backend, storage });
    await screen.findByText("Valentina Gómez");
    const before = backend.requests.length;

    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByText(/Cerraste sesión/)).toBeInTheDocument();
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBeNull();
    expect(pending.pending(operationScope(account.id, "transfer"))).toBeNull();
    expect(pending.pending(operationScope("otra-cuenta", "deposit"))).not.toBeNull();
    expect(screen.queryByText("Valentina Gómez")).not.toBeInTheDocument();
    // Cerrar sesión es local: después solo pueden terminar lecturas (GET) que ya estaban en curso.
    const after = backend.requests.slice(before);
    expect(after.every((request) => request.method === "GET")).toBe(true);
    expect(backend.requests.some((request) => /logout|signout/i.test(request.url))).toBe(false);
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/acceso/);
  });

  it("después de cerrar sesión, las rutas privadas vuelven a pedir acceso", async () => {
    const backend = fakeBackend();
    backend.addAccount(TOKEN, "Valentina Gómez");
    const { user } = renderApp({ path: "/", backend, storage: storageWithToken() });
    await screen.findByText("Valentina Gómez");
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await screen.findByText(/Cerraste sesión/);

    expect(screen.getByRole("tab", { name: "Crear cuenta" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("401 durante la sesión", () => {
  it("cualquier llamada rechazada con 401 cierra la sesión y lleva a «Acceder»", async () => {
    const backend = fakeBackend();
    backend.addAccount(TOKEN, "Valentina Gómez");
    const storage = storageWithToken();
    const { api } = renderApp({ path: "/movimientos", backend, storage });
    await screen.findByRole("heading", { name: "Mis movimientos" });

    // El token se regeneró en otro lugar: el backend ya no lo reconoce.
    backend.accounts.delete(TOKEN);
    await act(async () => {
      await api.getMe().catch(() => undefined);
    });

    expect(await screen.findByText("Tu sesión terminó")).toBeInTheDocument();
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBeNull();
    expect(screen.queryByText("Valentina Gómez")).not.toBeInTheDocument();
  });
});

describe("rutas protegidas", () => {
  it.each(["/", "/enviar", "/recargar", "/solicitudes", "/movimientos", "/cuenta"])(
    "%s sin sesión lleva a /acceso sin pedir datos privados",
    async (path) => {
      const { backend } = renderApp({ path });
      expect(await screen.findByRole("tab", { name: "Ya tengo cuenta" })).toBeInTheDocument();
      expect(screen.getByTestId("location")).toHaveTextContent(/^\/acceso/);
      expect(backend.apiRequests()).toHaveLength(0);
    },
  );

  it("/acceso con sesión activa lleva al panel", async () => {
    const backend = fakeBackend();
    backend.addAccount(TOKEN, "Valentina Gómez");
    renderApp({ path: "/acceso", backend, storage: storageWithToken() });
    expect(await screen.findByRole("heading", { name: "Tu dinero, en movimiento." })).toBeInTheDocument();
  });

  it("una ruta desconocida termina en el panel o en /acceso, nunca en blanco", async () => {
    renderApp({ path: "/no-existe" });
    expect(await screen.findByRole("tab", { name: "Crear cuenta" })).toBeInTheDocument();
  });

  it("las seis secciones privadas muestran su cabecera de Figma", async () => {
    const backend = fakeBackend();
    backend.addAccount(TOKEN, "Valentina Gómez");
    const { user } = renderApp({ path: "/", backend, storage: storageWithToken() });
    await screen.findByText("Valentina Gómez");
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    for (const [link, heading] of [
      ["Enviar dinero", "Enviar dinero simulado"],
      ["Recargar saldo", "Recargar saldo"],
      ["Solicitudes", "Solicitudes de dinero"],
      ["Movimientos", "Mis movimientos"],
      ["Mi cuenta", "Mi cuenta"],
      ["Inicio", "Tu dinero, en movimiento."],
    ] as const) {
      await user.click(within(nav).getByRole("link", { name: link }));
      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    }
  });
});

describe("el token no aparece en URL, historial, logs ni mensajes", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("registro y acceso con BrowserRouter: ni location ni history.state contienen el token", async () => {
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const backend = fakeBackend();
    const storage = newTabStorage();
    const tokenStore = createTokenStore(storage.session);
    const api = createEndpoints(
      createApiClient({
        getToken: () => tokenStore.get(),
        onUnauthorized: () => {
          tokenStore.clear();
        },
        fetchFn: backend.fetchFn,
      }),
    );
    window.history.replaceState(null, "", "/movimientos");
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(
      <BrowserRouter>
        <App
          api={api}
          tokenStore={tokenStore}
          idempotency={createIdempotencyManager({ store: memoryStore() })}
          noticeStore={storage.notices}
        />
      </BrowserRouter>,
    );

    // 1. Crear cuenta.
    await user.click(await screen.findByRole("tab", { name: "Crear cuenta" }));
    await user.type(screen.getByLabelText(/nombre completo del titular/i), "Ana");
    await user.click(screen.getByRole("button", { name: "Crear mi cuenta" }));
    await screen.findByRole("heading", { name: "¡Cuenta creada con éxito!" });
    const token = [...backend.accounts.keys()][0] ?? "";
    const seen = () => `${window.location.href} ${JSON.stringify(window.history.state)} ${document.title}`;
    expect(seen()).not.toContain(token);
    await user.click(screen.getByLabelText("Ya guardé mi token en un lugar seguro."));
    await user.click(screen.getByRole("button", { name: "Continuar a mi panel" }));
    await screen.findByRole("heading", { name: "Tu dinero, en movimiento." });
    expect(seen()).not.toContain(token);

    // 2. Cerrar sesión y volver a entrar con el mismo token.
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await user.click(await screen.findByRole("tab", { name: "Ya tengo cuenta" }));
    await user.type(screen.getByLabelText(/bearer token de acceso/i), token);
    await user.click(screen.getByRole("button", { name: "Acceder a mi cuenta" }));
    await screen.findByRole("heading", { name: "Tu dinero, en movimiento." });
    expect(seen()).not.toContain(token);
    expect(document.body.innerHTML).not.toContain(token);

    // 3. Un token rechazado tampoco aparece en el mensaje de error.
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await user.click(await screen.findByRole("tab", { name: "Ya tengo cuenta" }));
    await user.type(screen.getByLabelText(/bearer token de acceso/i), "tokenRechazado123");
    await user.click(screen.getByRole("button", { name: "Acceder a mi cuenta" }));
    const error = await screen.findByText(/El servidor no reconoció este token/);
    expect(error.textContent).not.toContain("tokenRechazado123");

    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(token);
    }
    expect(window.localStorage.length).toBe(0);
  });

  it("el estado de navegación de MemoryRouter solo guarda la ruta pedida", async () => {
    locations.length = 0;
    const backend = fakeBackend();
    backend.addAccount(TOKEN, "Valentina Gómez");
    const { user } = renderApp({ path: "/cuenta", backend });
    await user.type(await screen.findByLabelText(/bearer token de acceso/i), TOKEN);
    await user.click(screen.getByRole("button", { name: "Acceder a mi cuenta" }));
    await screen.findByRole("heading", { level: 1, name: "Mi cuenta" });

    for (const location of locations) {
      expect(JSON.stringify(location)).not.toContain(TOKEN);
    }
    expect(locations.some((location) => JSON.stringify(location.state).includes("/cuenta"))).toBe(true);
  });
});
