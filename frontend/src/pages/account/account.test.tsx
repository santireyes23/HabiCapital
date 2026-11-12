import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TOKEN_UNCONFIRMED_STORAGE_KEY } from "../../session/SessionProvider";
import { TOKEN_STORAGE_KEY } from "../../session/tokenStore";
import { deferred, fakeBackend, networkDown } from "../../test/fakeBackend";
import { jsonResponse } from "../../test/http";
import { locations, newTabStorage, renderApp } from "../../test/renderApp";

const TOKEN = "acctTok_Zx9abcDEF123ghiJKL456mnoPQR789stuVW";

function setup() {
  const backend = fakeBackend();
  const account = backend.addAccount(TOKEN, "Camilo Aristizábal", 2_450_000);
  const storage = newTabStorage();
  storage.session.set(TOKEN_STORAGE_KEY, TOKEN);
  return { backend, account, storage };
}

async function openAccount() {
  const ctx = setup();
  const view = renderApp({ path: "/cuenta", backend: ctx.backend, storage: ctx.storage });
  await screen.findByRole("heading", { level: 1, name: "Mi cuenta" });
  // Espera la lectura inicial (validación de la sesión + actualización de Mi cuenta) para que
  // las respuestas preparadas en cada prueba no las consuma esa carga.
  await waitFor(() => {
    expect(ctx.backend.requestsTo("/accounts/me")).toHaveLength(2);
  });
  return { ...ctx, ...view };
}

const rotatedTokens = (backend: ReturnType<typeof fakeBackend>) =>
  [...backend.accounts.keys()].filter((token) => token.startsWith("rot"));

describe("Mi cuenta: datos reales", () => {
  it("muestra titular, UUID completo, fecha de creación, saldo y versión real", async () => {
    const { account } = await openAccount();
    const info = screen.getByRole("article", { name: "Información de la cuenta" });
    expect(within(info).getByText("Camilo Aristizábal")).toBeInTheDocument();
    expect(within(info).getByText(account.id)).toBeInTheDocument();
    expect(within(info).getByText("Creada: 12 Nov, 2026")).toBeInTheDocument();
    expect(info).toHaveTextContent("$2.450.000 COP");
    expect(screen.getByText("Versión cliente: 0.1.0 · COP")).toBeInTheDocument();
    expect(screen.queryByText(/Tipo: Personal/)).not.toBeInTheDocument();
  });

  it("copia el UUID completo", async () => {
    const { user, account } = await openAccount();
    await user.click(screen.getByRole("button", { name: "Copiar UUID de la cuenta" }));
    expect(await navigator.clipboard.readText()).toBe(account.id);
    expect(screen.getByRole("button", { name: "Copiar UUID de la cuenta" })).toHaveTextContent("Copiado");
  });

  it("cerrar sesión desde Mi cuenta borra el token y vuelve a «Acceder»", async () => {
    const { user, storage } = await openAccount();
    const security = screen.getByRole("article", { name: "Seguridad y sesión" });
    await user.click(within(security).getByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByText(/Cerraste sesión/)).toBeInTheDocument();
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBeNull();
  });
});

describe("regenerar token (POST /accounts/me/token)", () => {
  it("pide confirmación y «Cancelar» no llama al servidor", async () => {
    const { user, backend } = await openAccount();
    await user.click(screen.getByRole("button", { name: "Regenerar token" }));
    expect(screen.getByText(/El token actual dejará de funcionar/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(backend.requestsTo("/accounts/me/token")).toHaveLength(0);
  });

  it("muestra el token nuevo una sola vez, lo guarda y el anterior deja de servir", async () => {
    const { user, backend, storage, account } = await openAccount();
    await user.click(screen.getByRole("button", { name: "Regenerar token" }));
    await user.click(screen.getByRole("button", { name: "Sí, regenerar token" }));

    const [newToken] = rotatedTokens(backend);
    expect(await screen.findByText(newToken ?? "")).toBeInTheDocument();
    expect(backend.requestsTo("/accounts/me/token", "POST")).toHaveLength(1);
    expect(backend.accounts.has(TOKEN)).toBe(false);
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBe(newToken);
    expect(storage.notices.get(TOKEN_UNCONFIRMED_STORAGE_KEY)).toBe(account.id);

    await user.click(screen.getByRole("button", { name: "Copiar nuevo token" }));
    expect(await navigator.clipboard.readText()).toBe(newToken);

    const done = screen.getByRole("button", { name: "Listo, ocultar el token" });
    expect(done).toBeDisabled();
    await user.click(screen.getByLabelText("Ya guardé mi nuevo token."));
    await user.click(done);

    expect(document.body.innerHTML).not.toContain(newToken);
    expect(storage.notices.get(TOKEN_UNCONFIRMED_STORAGE_KEY)).toBeNull();
    // La sesión sigue funcionando con el token nuevo.
    expect(screen.getByRole("button", { name: "Regenerar token" })).toBeInTheDocument();
  });

  it("evita el doble envío: un solo POST aunque se pulse varias veces", async () => {
    const { user, backend } = await openAccount();
    const pending = deferred();
    backend.nextFor("POST", "/accounts/me/token", pending.responder);
    await user.click(screen.getByRole("button", { name: "Regenerar token" }));
    await user.click(screen.getByRole("button", { name: "Sí, regenerar token" }));
    const busy = screen.getByRole("button", { name: "Regenerando token…" });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(backend.requestsTo("/accounts/me/token")).toHaveLength(1);
    pending.release(jsonResponse(200, { token: "rotManual_Qw7ertyUIOP456asdfGHJ789zx" }));
    expect(await screen.findByText("rotManual_Qw7ertyUIOP456asdfGHJ789zx")).toBeInTheDocument();
  });

  it("error de red sin cambio en el servidor: comprueba el token y dice que no cambió, sin reintentar", async () => {
    const { user, backend, storage } = await openAccount();
    backend.nextFor("POST", "/accounts/me/token", networkDown);
    await user.click(screen.getByRole("button", { name: "Regenerar token" }));
    await user.click(screen.getByRole("button", { name: "Sí, regenerar token" }));

    expect(await screen.findByText("El token no cambió")).toBeInTheDocument();
    expect(backend.requestsTo("/accounts/me/token")).toHaveLength(1);
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBe(TOKEN);
    // La comprobación usó el token guardado, en la cabecera.
    expect(backend.requestsTo("/accounts/me").at(-1)?.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("respuesta perdida tras regenerar: si el token anterior ya no sirve, avisa de la posible pérdida de acceso", async () => {
    const { user, backend } = await openAccount();
    backend.nextFor("POST", "/accounts/me/token", () => {
      // El servidor regeneró (el anterior ya no existe) pero la respuesta no llegó.
      backend.accounts.delete(TOKEN);
      throw new TypeError("Failed to fetch");
    });
    await user.click(screen.getByRole("button", { name: "Regenerar token" }));
    await user.click(screen.getByRole("button", { name: "Sí, regenerar token" }));

    const alert = await screen.findByText("Es posible que hayas perdido el acceso a esta cuenta");
    expect(alert.closest("[role=alert]")).toHaveTextContent(/no alcanzamos a recibir el nuevo/);
    expect(backend.requestsTo("/accounts/me/token")).toHaveLength(1);
    await user.click(within(alert.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByText(/Cerraste sesión/)).toBeInTheDocument();
  });

  it("si tampoco puede comprobar el token, no afirma nada y permite comprobar de nuevo", async () => {
    const { user, backend } = await openAccount();
    backend.nextFor("POST", "/accounts/me/token", () => jsonResponse(200, { inesperado: true }));
    backend.nextFor("GET", "/accounts/me", networkDown);
    await user.click(screen.getByRole("button", { name: "Regenerar token" }));
    await user.click(screen.getByRole("button", { name: "Sí, regenerar token" }));

    expect(await screen.findByText("No sabemos si el token se regeneró")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regenerar token" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Comprobar de nuevo" }));
    expect(await screen.findByText("El token no cambió")).toBeInTheDocument();
    expect(backend.requestsTo("/accounts/me/token")).toHaveLength(1);
  });

  it("un rechazo definitivo del servidor no cambia el token", async () => {
    const { user, backend, storage } = await openAccount();
    backend.nextFor("POST", "/accounts/me/token", () => jsonResponse(403, { detail: "Operación no permitida" }));
    await user.click(screen.getByRole("button", { name: "Regenerar token" }));
    await user.click(screen.getByRole("button", { name: "Sí, regenerar token" }));
    const alert = await screen.findByText("No se regeneró el token");
    expect(alert.closest("[role=alert]")).toHaveTextContent("Operación no permitida");
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBe(TOKEN);
  });

  it("opción A: si se recarga sin confirmar, la sesión sigue con el token nuevo y aparece el aviso", async () => {
    const { user, backend, storage } = await openAccount();
    await user.click(screen.getByRole("button", { name: "Regenerar token" }));
    await user.click(screen.getByRole("button", { name: "Sí, regenerar token" }));
    const [newToken] = rotatedTokens(backend);
    await screen.findByText(newToken ?? "");

    const before = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);

    // Recarga: misma pestaña, estado de React perdido.
    document.body.innerHTML = "";
    renderApp({ path: "/cuenta", backend, storage });
    expect(await screen.findByText("No confirmaste que guardaste tu token")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(newToken);
    expect(backend.requestsTo("/accounts/me").at(-1)?.headers.get("Authorization")).toBe(`Bearer ${newToken ?? ""}`);
  });

  it("el token nuevo no aparece en URL, navegación, consola ni mensajes", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    locations.length = 0;
    const { user, backend } = await openAccount();
    await user.click(screen.getByRole("button", { name: "Regenerar token" }));
    await user.click(screen.getByRole("button", { name: "Sí, regenerar token" }));
    const [newToken] = rotatedTokens(backend);
    await screen.findByText(newToken ?? "");
    await user.click(screen.getByLabelText("Ya guardé mi nuevo token."));
    await user.click(screen.getByRole("button", { name: "Listo, ocultar el token" }));

    await waitFor(() => {
      expect(document.body.innerHTML).not.toContain(newToken);
    });
    for (const location of locations) expect(JSON.stringify(location)).not.toContain(newToken);
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(newToken);
        expect(JSON.stringify(call)).not.toContain(TOKEN);
      }
    }
    expect(window.localStorage.length).toBe(0);
  });
});
