import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TOKEN_UNCONFIRMED_STORAGE_KEY } from "../../session/SessionProvider";
import { TOKEN_STORAGE_KEY } from "../../session/tokenStore";
import { deferred, fakeBackend, networkDown } from "../../test/fakeBackend";
import { jsonResponse } from "../../test/http";
import { renderApp } from "../../test/renderApp";

async function submitName(user: ReturnType<typeof renderApp>["user"], name: string) {
  await user.type(screen.getByLabelText(/nombre completo del titular/i), name);
  await user.click(screen.getByRole("button", { name: "Crear mi cuenta" }));
}

describe("crear cuenta (POST /accounts)", () => {
  it("muestra el UUID y el token reales de la respuesta 201 y los guarda solo en la sesión", async () => {
    const { user, backend, storage } = renderApp({ path: "/acceso" });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });

    await submitName(user, "  Ana Gómez  ");

    expect(await screen.findByRole("heading", { name: "¡Cuenta creada con éxito!" })).toBeInTheDocument();
    const [request] = backend.apiRequests();
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("/api/accounts");
    expect(request?.body).toBe('{"owner_name":"Ana Gómez"}');
    expect(request?.headers.has("Authorization")).toBe(false);

    const [token, account] = [...backend.accounts.entries()][0] ?? [];
    expect(screen.getByText(account?.id ?? "")).toBeInTheDocument();
    expect(screen.getByText(token ?? "")).toBeInTheDocument();
    // Opción A: guardado en cuanto llega el 201, con el aviso pendiente.
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBe(token);
    expect(storage.notices.get(TOKEN_UNCONFIRMED_STORAGE_KEY)).toBe(account?.id);
  });

  it("exige marcar «Ya guardé mi token» y después no vuelve a mostrar el token", async () => {
    const { user, backend, storage } = renderApp({ path: "/acceso" });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });
    await submitName(user, "Ana Gómez");
    await screen.findByRole("heading", { name: "¡Cuenta creada con éxito!" });
    const token = [...backend.accounts.keys()][0] ?? "";

    const continueButton = screen.getByRole("button", { name: "Continuar a mi panel" });
    expect(continueButton).toBeDisabled();
    await user.click(screen.getByLabelText("Ya guardé mi token en un lugar seguro."));
    expect(continueButton).toBeEnabled();
    await user.click(continueButton);

    expect(await screen.findByRole("heading", { name: "Tu dinero, en movimiento." })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
    expect(screen.queryByText(token)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(token);
    expect(storage.notices.get(TOKEN_UNCONFIRMED_STORAGE_KEY)).toBeNull();
    expect(screen.queryByText("No confirmaste que guardaste tu token")).not.toBeInTheDocument();
  });

  it("copia el UUID y el token con sus botones", async () => {
    const { user, backend } = renderApp({ path: "/acceso" });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });
    await submitName(user, "Ana Gómez");
    await screen.findByRole("heading", { name: "¡Cuenta creada con éxito!" });
    const [token, account] = [...backend.accounts.entries()][0] ?? [];

    await user.click(screen.getByRole("button", { name: "Copiar token" }));
    expect(await navigator.clipboard.readText()).toBe(token);
    await user.click(screen.getByRole("button", { name: "Copiar UUID" }));
    expect(await navigator.clipboard.readText()).toBe(account?.id);
  });

  it("si el portapapeles falla, lo dice y selecciona el texto para copiarlo a mano", async () => {
    const { user } = renderApp({ path: "/acceso" });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });
    await submitName(user, "Ana Gómez");
    await screen.findByRole("heading", { name: "¡Cuenta creada con éxito!" });
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denegado"));

    await user.click(screen.getByRole("button", { name: "Copiar token" }));

    expect(await screen.findByText(/No se pudo copiar automáticamente/)).toBeInTheDocument();
  });

  it("avisa al recargar o cerrar la pestaña mientras el token no se confirmó", async () => {
    const { user } = renderApp({ path: "/acceso" });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });
    await submitName(user, "Ana Gómez");
    await screen.findByRole("heading", { name: "¡Cuenta creada con éxito!" });

    const before = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);

    await user.click(screen.getByLabelText("Ya guardé mi token en un lugar seguro."));
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it.each([
    ["vacío", "   ", "Ingresa el nombre completo del titular."],
    ["más de 100 caracteres", "a".repeat(101), "El nombre admite máximo 100 caracteres."],
  ])("valida el nombre (%s) sin llamar al servidor", async (_case, name, message) => {
    const { user, backend } = renderApp({ path: "/acceso" });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });
    await submitName(user, name);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(backend.apiRequests()).toHaveLength(0);
  });

  it("un 422 del servidor se muestra en el campo y no guarda nada", async () => {
    const backend = fakeBackend();
    backend.next(() =>
      jsonResponse(422, { detail: [{ loc: ["body", "owner_name"], msg: "too long", type: "x" }] }),
    );
    const { user, storage } = renderApp({ path: "/acceso", backend });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });

    await submitName(user, "Ana");

    expect(await screen.findByText(/El nombre no es válido/)).toBeInTheDocument();
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("error de red: explica que no se sabe si se creó, no reintenta y no guarda token", async () => {
    const backend = fakeBackend();
    backend.next(networkDown);
    const { user, storage } = renderApp({ path: "/acceso", backend });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });

    await submitName(user, "Ana");

    const alert = await screen.findByText("No pudimos confirmar si la cuenta se creó");
    expect(alert.closest("[role=alert]")).toHaveTextContent(/podría crearse otra cuenta/);
    expect(backend.apiRequests()).toHaveLength(1);
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "Crear mi cuenta" })).toBeEnabled();
  });

  it("una respuesta 201 sin token válido no se acepta ni se guarda", async () => {
    const backend = fakeBackend();
    backend.next(() =>
      jsonResponse(201, {
        id: "00000000-0000-4000-8000-000000000009",
        owner_name: "Ana",
        balance: 0,
        created_at: "2026-11-12T15:00:00Z",
      }),
    );
    const { user, storage } = renderApp({ path: "/acceso", backend });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });

    await submitName(user, "Ana");

    expect(await screen.findByText("No pudimos confirmar si la cuenta se creó")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "¡Cuenta creada con éxito!" })).not.toBeInTheDocument();
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("evita envíos duplicados mientras la petición está en curso", async () => {
    const backend = fakeBackend();
    const pending = deferred();
    backend.next(pending.responder);
    const { user } = renderApp({ path: "/acceso", backend });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });

    await user.type(screen.getByLabelText(/nombre completo del titular/i), "Ana");
    const button = screen.getByRole("button", { name: "Crear mi cuenta" });
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Creando cuenta…" }));
    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { name: "Creando cuenta…" })).toBeDisabled();
    expect(backend.apiRequests()).toHaveLength(1);

    pending.release(
      jsonResponse(201, {
        id: "00000000-0000-4000-8000-000000000001",
        owner_name: "Ana",
        balance: 0,
        created_at: "2026-11-12T15:00:00Z",
        token: "tokPendiente_Zx9abcDEF123ghiJKL456mnoPQR789",
      }),
    );
    expect(await screen.findByRole("heading", { name: "¡Cuenta creada con éxito!" })).toBeInTheDocument();
    expect(backend.apiRequests()).toHaveLength(1);
  });
});

describe("opción A: recargar mientras se muestra el token", () => {
  it("la sesión sigue, el token NO se vuelve a mostrar y aparece el aviso", async () => {
    const backend = fakeBackend();
    const first = renderApp({ path: "/acceso", backend });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });
    await submitName(first.user, "Ana Gómez");
    await screen.findByRole("heading", { name: "¡Cuenta creada con éxito!" });
    const token = [...backend.accounts.keys()][0] ?? "";
    first.unmount();

    // Recarga: misma pestaña (mismo sessionStorage), estado de React perdido.
    renderApp({ path: "/acceso", backend, storage: first.storage });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });

    expect(await screen.findByRole("heading", { name: "Tu dinero, en movimiento." })).toBeInTheDocument();
    const banner = screen.getByText("No confirmaste que guardaste tu token").closest("[role=alert]");
    expect(banner).toHaveTextContent(/Mi cuenta/);
    expect(document.body.innerHTML).not.toContain(token);
    // Se validó con el backend usando el token guardado.
    const me = backend.requestsTo("/accounts/me").at(-1);
    expect(me?.url).toBe("/api/accounts/me");
    expect(me?.headers.get("Authorization")).toBe(`Bearer ${token}`);
  });

  it("«Entendido» oculta el aviso y no vuelve tras otra recarga", async () => {
    const backend = fakeBackend();
    const first = renderApp({ path: "/acceso", backend });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });
    await submitName(first.user, "Ana Gómez");
    await screen.findByRole("heading", { name: "¡Cuenta creada con éxito!" });
    first.unmount();

    const second = renderApp({ path: "/", backend, storage: first.storage });
    const banner = await screen.findByText("No confirmaste que guardaste tu token");
    await second.user.click(
      within(banner.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "Entendido" }),
    );
    expect(screen.queryByText("No confirmaste que guardaste tu token")).not.toBeInTheDocument();
    second.unmount();

    renderApp({ path: "/", backend, storage: first.storage });
    await screen.findByRole("heading", { name: "Tu dinero, en movimiento." });
    await waitFor(() => {
      expect(screen.queryByText("No confirmaste que guardaste tu token")).not.toBeInTheDocument();
    });
  });
});
