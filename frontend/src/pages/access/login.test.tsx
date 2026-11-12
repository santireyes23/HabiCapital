import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TOKEN_STORAGE_KEY } from "../../session/tokenStore";
import { fakeBackend, networkDown } from "../../test/fakeBackend";
import { renderApp } from "../../test/renderApp";

const TOKEN = "AbC123_realTokenFromBackend-xyz0987654321QwErT";

async function login(user: ReturnType<typeof renderApp>["user"], token: string) {
  await user.click(screen.getByRole("tab", { name: "Ya tengo cuenta" }));
  await user.type(screen.getByLabelText(/bearer token de acceso/i), token);
  await user.click(screen.getByRole("button", { name: "Acceder a mi cuenta" }));
}

describe("«Ya tengo cuenta» (GET /accounts/me)", () => {
  it("valida con el backend, guarda el token solo tras el 200 y entra al panel", async () => {
    const backend = fakeBackend();
    backend.addAccount(TOKEN, "Mateo Restrepo");
    const { user, storage } = renderApp({ path: "/acceso", backend });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });

    await login(user, `  ${TOKEN}  `);

    expect(await screen.findByRole("heading", { name: "Tu dinero, en movimiento." })).toBeInTheDocument();
    expect(screen.getByText("Mateo Restrepo")).toBeInTheDocument();
    const [request] = backend.apiRequests();
    expect(request?.url).toBe("/api/accounts/me");
    expect(request?.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(request?.url).not.toContain(TOKEN);
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBe(TOKEN);
  });

  it("no exige ningún prefijo: el único criterio es la respuesta del backend", async () => {
    const backend = fakeBackend();
    backend.addAccount("x9", "Sin prefijo");
    const { user } = renderApp({ path: "/acceso", backend });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });
    await login(user, "x9");
    expect(await screen.findByText("Sin prefijo")).toBeInTheDocument();
  });

  it("un token con prefijo «hb_sec_» que el backend no conoce se rechaza", async () => {
    const { user, storage } = renderApp({ path: "/acceso" });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });
    await login(user, "hb_sec_99182a4c88f102e7b45a99014cd73");
    expect(await screen.findByText(/El servidor no reconoció este token/)).toBeInTheDocument();
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("401: mensaje comprensible, no guarda nada y sigue en /acceso", async () => {
    const { user, storage, backend } = renderApp({ path: "/acceso" });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });

    await login(user, TOKEN);

    const message = await screen.findByText(/El servidor no reconoció este token/);
    expect(message.textContent).not.toContain(TOKEN);
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/acceso/);
    expect(backend.apiRequests()).toHaveLength(1);
  });

  it("error de red: no finge el acceso y permite reintentar", async () => {
    const backend = fakeBackend();
    backend.addAccount(TOKEN, "Mateo Restrepo");
    backend.next(networkDown);
    const { user, storage } = renderApp({ path: "/acceso", backend });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });

    await login(user, TOKEN);
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeInTheDocument();
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBeNull();
    expect(screen.queryByText("Mateo Restrepo")).not.toBeInTheDocument();
    // Sin reintento automático: un solo intento hasta que el usuario vuelve a enviar.
    expect(backend.requestsTo("/accounts/me")).toHaveLength(1);

    // El token sigue en el campo: basta con volver a enviar.
    await user.click(screen.getByRole("button", { name: "Acceder a mi cuenta" }));
    expect(await screen.findByText("Mateo Restrepo")).toBeInTheDocument();
    // 2 intentos de acceso + 1 lectura del saldo al abrir Inicio (etapa 3).
    expect(backend.requestsTo("/accounts/me")).toHaveLength(3);
  });

  it("rechaza tokens con espacios internos sin llamar al servidor", async () => {
    const { user, backend } = renderApp({ path: "/acceso" });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });
    await login(user, "dos partes");
    expect(screen.getByRole("alert")).toHaveTextContent(/espacios o caracteres no válidos/);
    expect(backend.apiRequests()).toHaveLength(0);
  });

  it("el token está oculto por defecto y se puede mostrar y ocultar", async () => {
    const { user } = renderApp({ path: "/acceso" });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });
    await user.click(screen.getByRole("tab", { name: "Ya tengo cuenta" }));
    const input = screen.getByLabelText(/bearer token de acceso/i);
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "off");

    await user.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(input).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Ocultar" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("después de entrar vuelve a la ruta protegida que se pidió", async () => {
    const backend = fakeBackend();
    backend.addAccount(TOKEN, "Mateo Restrepo");
    const { user } = renderApp({ path: "/movimientos", backend });

    // Sin sesión, /movimientos lleva a /acceso con la pestaña «Ya tengo cuenta».
    expect(await screen.findByRole("tab", { name: "Ya tengo cuenta" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.type(screen.getByLabelText(/bearer token de acceso/i), TOKEN);
    await user.click(screen.getByRole("button", { name: "Acceder a mi cuenta" }));

    expect(await screen.findByRole("heading", { name: "Mis movimientos" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/movimientos$/);
  });
});
