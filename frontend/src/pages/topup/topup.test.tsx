import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createIdempotencyManager, PENDING_OPERATIONS_STORAGE_KEY } from "../../api/idempotency";
import { TOKEN_STORAGE_KEY } from "../../session/tokenStore";
import { deferred, fakeBackend, networkDown } from "../../test/fakeBackend";
import { jsonResponse, type RecordedRequest } from "../../test/http";
import { newTabStorage, renderApp } from "../../test/renderApp";
import { depositScope } from "./deposit";

const TOKEN = "topupTok_Zx9abcDEF123ghiJKL456mnoPQR789stuV";

function setup(balance = 0) {
  const backend = fakeBackend();
  const account = backend.addAccount(TOKEN, "Camilo Aristizábal", balance);
  const storage = newTabStorage();
  storage.session.set(TOKEN_STORAGE_KEY, TOKEN);
  return { backend, account, storage };
}

async function openTopUp(options: { balance?: number; timeoutMs?: number } = {}) {
  const ctx = setup(options.balance);
  const view = renderApp({
    path: "/recargar",
    backend: ctx.backend,
    storage: ctx.storage,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  await screen.findByRole("heading", { name: "Nueva recarga" });
  return { ...ctx, ...view };
}

const amountInput = () => screen.getByLabelText(/Monto en pesos colombianos/);
const deposits = (backend: ReturnType<typeof fakeBackend>) =>
  backend.requestsTo("/accounts/me/deposits", "POST");

async function reachConfirm(user: ReturnType<typeof renderApp>["user"], amount: string) {
  await user.clear(amountInput());
  await user.type(amountInput(), amount);
  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await screen.findByText("Paso 2 de 2: Confirmar");
}

async function confirm(user: ReturnType<typeof renderApp>["user"]) {
  await user.click(screen.getByRole("button", { name: "Confirmar recarga" }));
}

describe("recargar saldo: formulario", () => {
  it.each([
    ["", "Ingresa un monto."],
    ["0", "El monto mínimo es $1 COP."],
    ["-5000", "Ingresa pesos enteros, sin decimales."],
    ["10.5", "Ingresa pesos enteros, sin decimales."],
    ["150000,50", "Ingresa pesos enteros, sin decimales."],
    ["abc", "Ingresa pesos enteros, sin decimales."],
    ["10000001", "El monto máximo es $10.000.000 COP."],
  ])("rechaza «%s» sin llamar al servidor", async (value, message) => {
    const { user, backend } = await openTopUp();
    if (value !== "") await user.type(amountInput(), value);
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(amountInput()).toHaveAttribute("aria-invalid", "true");
    expect(deposits(backend)).toHaveLength(0);
  });

  it("los montos rápidos REEMPLAZAN el valor y no llevan «+»", async () => {
    const { user } = await openTopUp();
    await user.type(amountInput(), "123");
    await user.click(screen.getByRole("button", { name: "$100.000" }));
    expect(amountInput()).toHaveValue("100000");
    await user.click(screen.getByRole("button", { name: "$50.000" }));
    expect(amountInput()).toHaveValue("50000");
    for (const label of ["$50.000", "$100.000", "$250.000", "$500.000"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByText(/\+\$/)).not.toBeInTheDocument();
  });

  it("no tiene campo de descripción (no existe en Figma)", async () => {
    await openTopUp();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("acepta el máximo exacto y montos con puntos de miles", async () => {
    const { user } = await openTopUp();
    await reachConfirm(user, "10.000.000");
    expect(screen.getAllByText("$10.000.000 COP")[0]).toBeInTheDocument();
  });
});

describe("recargar saldo: confirmación", () => {
  it("muestra monto, saldo actual del backend y saldo estimado; «Editar» vuelve con el monto", async () => {
    const { user, backend, account } = await openTopUp({ balance: 20_000 });
    account.balance = 30_000; // el saldo cambió en el servidor: se usa el leído al confirmar
    const before = backend.requestsTo("/accounts/me").length;
    await reachConfirm(user, "100000");

    const summary = screen.getByText("Monto de la recarga").closest("div[aria-live]") as HTMLElement;
    expect(summary).toHaveTextContent("$100.000 COP");
    await waitFor(() => {
      expect(summary).toHaveTextContent("Saldo actual$30.000 COP");
    });
    expect(summary).toHaveTextContent("Saldo estimado después$130.000 COP");
    expect(backend.requestsTo("/accounts/me").length).toBe(before + 1);
    expect(screen.getByText(/El saldo estimado es informativo/)).toBeInTheDocument();
    expect(deposits(backend)).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Editar" }));
    expect(amountInput()).toHaveValue("100000");
  });
});

describe("recargar saldo: operación real", () => {
  it("éxito: un POST con Idempotency-Key, resultado y saldo reales, toast y sin pendientes", async () => {
    const { user, backend, storage } = await openTopUp({ balance: 5_000 });
    await reachConfirm(user, "100000");
    await confirm(user);

    expect(await screen.findByRole("heading", { name: "Recarga completada" })).toBeInTheDocument();
    const [post] = deposits(backend);
    expect(post?.body).toBe('{"amount":100000}');
    expect(post?.headers.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(post?.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);

    const section = screen.getByRole("region", { name: "Nueva recarga" });
    expect(section).toHaveTextContent("Monto acreditado+$100.000 COP");
    expect(section).toHaveTextContent("Saldo actualizado$105.000 COP");
    const toast = screen.getByText("Transacción completada").closest("aside");
    expect(toast).toHaveAttribute("role", "status");
    expect(toast).toHaveTextContent("Se acreditaron $100.000 COP. Saldo actualizado: $105.000 COP.");
    // El saldo de la cabecera es el que devolvió el backend.
    expect(screen.getByText("Saldo disponible actual").parentElement).toHaveTextContent("$105.000 COP");
    expect(storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Hacer otra recarga" }));
    expect(amountInput()).toHaveValue("");
    expect(screen.getByRole("link", { name: "Cancelar" })).toHaveAttribute("href", "/");
  });

  it("«Volver a Inicio» y los movimientos se actualizan con la recarga real", async () => {
    const { user } = await openTopUp();
    await reachConfirm(user, "250000");
    await confirm(user);
    await screen.findByRole("heading", { name: "Recarga completada" });
    await user.click(screen.getByRole("link", { name: "Volver a Inicio" }));
    // Inicio se carga aparte (carga diferida): primero se espera a que esté en pantalla, y el
    // monto se busca en sus movimientos (no en la pantalla de recarga, que se ve un instante más).
    await screen.findByRole("heading", { name: "Tu dinero, en movimiento." });
    const recent = await screen.findByRole("list", { name: "Últimos movimientos" });
    expect(await within(recent).findByText("+$250.000 COP")).toBeInTheDocument();
  });

  it("respuesta repetida (Idempotent-Replayed): «Esta recarga ya se había aplicado»", async () => {
    const { user, backend } = await openTopUp();
    backend.nextFor("POST", "/accounts/me/deposits", () =>
      jsonResponse(
        201,
        {
          transaction_id: "dddddddd-0000-4000-8000-000000000077",
          amount: 50_000,
          description: null,
          balance: 50_000,
          created_at: "2026-11-12T16:00:00+00:00",
        },
        { "Idempotent-Replayed": "true" },
      ),
    );
    await reachConfirm(user, "50000");
    await confirm(user);
    expect(await screen.findByRole("heading", { name: "Esta recarga ya se había aplicado" })).toBeInTheDocument();
    const toasts = screen.getAllByRole("status").filter((node) => node.tagName === "ASIDE");
    expect(toasts[0]).toHaveTextContent("Esta recarga ya se había aplicado");
  });

  it("un doble clic no genera dos operaciones", async () => {
    const { user, backend } = await openTopUp();
    const pending = deferred();
    backend.nextFor("POST", "/accounts/me/deposits", pending.responder);
    await reachConfirm(user, "100000");
    await confirm(user);
    const busy = screen.getByRole("button", { name: "Procesando recarga…" });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(deposits(backend)).toHaveLength(1);
    pending.release(
      jsonResponse(201, {
        transaction_id: "dddddddd-0000-4000-8000-000000000088",
        amount: 100_000,
        description: null,
        balance: 100_000,
        created_at: "2026-11-12T16:00:00+00:00",
      }),
    );
    expect(await screen.findByRole("heading", { name: "Recarga completada" })).toBeInTheDocument();
    expect(deposits(backend)).toHaveLength(1);
  });

  it("un 4xx definitivo no se aplica, lo explica y no deja nada pendiente", async () => {
    const { user, backend, storage } = await openTopUp();
    backend.nextFor("POST", "/accounts/me/deposits", () =>
      jsonResponse(422, { detail: [{ loc: ["body", "amount"], msg: "bad", type: "x" }] }),
    );
    await reachConfirm(user, "100000");
    await confirm(user);
    expect(await screen.findByText("No se aplicó la recarga")).toBeInTheDocument();
    expect(amountInput()).toHaveValue("100000");
    expect(storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).toBeNull();
  });
});

describe("recargar saldo: resultados inciertos y recuperación", () => {
  const keyOf = (request: RecordedRequest | undefined) => request?.headers.get("Idempotency-Key");

  it.each([
    ["error de red", () => networkDown],
    ["error 5xx", () => () => jsonResponse(503, { detail: "Servicio no disponible" })],
    ["respuesta 2xx ilegible", () => () => jsonResponse(201, { ok: true })],
  ])("%s: «No sabemos si la recarga se aplicó», sin reintento automático", async (_name, responder) => {
    const { user, backend } = await openTopUp();
    backend.nextFor("POST", "/accounts/me/deposits", responder());
    await reachConfirm(user, "100000");
    await confirm(user);

    expect(await screen.findByText("No sabemos si la recarga se aplicó")).toBeInTheDocument();
    expect(deposits(backend)).toHaveLength(1);
    expect(screen.queryByText(/Cancelar recarga/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("timeout: resultado incierto y el reintento usa la MISMA clave y el mismo monto", async () => {
    const { user, backend, account } = await openTopUp({ timeoutMs: 50 });
    backend.nextFor("POST", "/accounts/me/deposits", (request) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
    );
    await reachConfirm(user, "100000");
    await confirm(user);
    expect(await screen.findByText("No sabemos si la recarga se aplicó")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("El servidor tardó demasiado en responder.");

    await user.click(screen.getByRole("button", { name: "Reintentar con la misma clave" }));
    expect(await screen.findByRole("heading", { name: "Recarga completada" })).toBeInTheDocument();
    const [first, second] = deposits(backend);
    expect(keyOf(second)).toBe(keyOf(first));
    expect(second?.body).toBe(first?.body);
    expect(account.balance).toBe(100_000);
  });

  it("si la primera sí se aplicó, el reintento con la misma clave no acredita dos veces", async () => {
    const { user, backend, account } = await openTopUp();
    // El servidor aplicó el depósito pero la respuesta se perdió.
    let applied: Response | undefined;
    backend.nextFor("POST", "/accounts/me/deposits", async (request) => {
      const real = await backend.fetchFn("/api/accounts/me/deposits", {
        method: "POST",
        headers: request.headers,
        body: request.body,
      });
      applied = real;
      throw new TypeError("Failed to fetch");
    });
    await reachConfirm(user, "100000");
    await confirm(user);
    await screen.findByText("No sabemos si la recarga se aplicó");
    expect(applied?.status).toBe(201);
    expect(account.balance).toBe(100_000);

    await user.click(screen.getByRole("button", { name: "Reintentar con la misma clave" }));
    expect(await screen.findByRole("heading", { name: "Esta recarga ya se había aplicado" })).toBeInTheDocument();
    expect(account.balance).toBe(100_000);
  });

  it("tras recargar la página ofrece recuperar la recarga pendiente y bloquea otra distinta", async () => {
    const ctx = await openTopUp();
    ctx.backend.nextFor("POST", "/accounts/me/deposits", networkDown);
    await reachConfirm(ctx.user, "100000");
    await confirm(ctx.user);
    await screen.findByText("No sabemos si la recarga se aplicó");
    ctx.unmount();

    // Recarga: mismo sessionStorage, estado de React perdido.
    const second = renderApp({ path: "/recargar", backend: ctx.backend, storage: ctx.storage });
    expect(await screen.findByText("No sabemos si la recarga se aplicó")).toBeInTheDocument();
    expect(screen.getByText(/Hay una recarga de esta sesión sin respuesta confirmada/)).toBeInTheDocument();
    expect(screen.getByText("Monto de la recarga pendiente").parentElement).toHaveTextContent("$100.000 COP");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/no se puede iniciar otra distinta/)).toBeInTheDocument();

    await second.user.click(screen.getByRole("button", { name: "Reintentar con la misma clave" }));
    expect(await screen.findByRole("heading", { name: "Recarga completada" })).toBeInTheDocument();
    const [first, retry] = deposits(ctx.backend);
    expect(retry?.headers.get("Idempotency-Key")).toBe(first?.headers.get("Idempotency-Key"));
  });

  it("una operación distinta no puede usar otra clave mientras haya una pendiente", async () => {
    const ctx = setup();
    createIdempotencyManager({ store: ctx.storage.operations }).begin(depositScope(ctx.account.id), { amount: 7_000 });
    renderApp({ path: "/recargar", backend: ctx.backend, storage: ctx.storage });
    expect(await screen.findByText("No sabemos si la recarga se aplicó")).toBeInTheDocument();
    expect(screen.getByText("Monto de la recarga pendiente").parentElement).toHaveTextContent("$7.000 COP");
    expect(screen.queryByRole("button", { name: "Continuar" })).not.toBeInTheDocument();
    expect(deposits(ctx.backend)).toHaveLength(0);
  });

  it("descartar exige confirmación, explica que no cancela nada y solo borra lo local", async () => {
    const { user, backend, storage } = await openTopUp();
    backend.nextFor("POST", "/accounts/me/deposits", networkDown);
    await reachConfirm(user, "100000");
    await confirm(user);
    await screen.findByText("No sabemos si la recarga se aplicó");
    const firstKey = deposits(backend)[0]?.headers.get("Idempotency-Key");

    await user.click(screen.getByRole("button", { name: "Dejar de intentar recuperar" }));
    expect(screen.getByText(/no cancela ni revierte/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Volver" }));
    expect(screen.getByText("No sabemos si la recarga se aplicó")).toBeInTheDocument();
    expect(storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Dejar de intentar recuperar" }));
    await user.click(screen.getByRole("button", { name: "Sí, dejar de intentar recuperar" }));
    expect(screen.getByText("Se descartó la información local")).toBeInTheDocument();
    expect(screen.getByText(/No se canceló ni se revirtió nada en el servidor/)).toBeInTheDocument();
    expect(storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).toBeNull();
    expect(deposits(backend)).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Ver movimientos" })).toHaveAttribute("href", "/movimientos");

    // Una recarga nueva recibe una clave nueva.
    await user.click(screen.getByRole("button", { name: "Nueva recarga" }));
    await reachConfirm(user, "20000");
    await confirm(user);
    await screen.findByRole("heading", { name: "Recarga completada" });
    expect(deposits(backend)[1]?.headers.get("Idempotency-Key")).not.toBe(firstKey);
  });
});

describe("recargar saldo: credenciales", () => {
  it("el token no viaja en el cuerpo, la URL, la clave ni lo guardado localmente, ni sale en consola", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const { user, backend, storage } = await openTopUp();
    backend.nextFor("POST", "/accounts/me/deposits", networkDown);
    await reachConfirm(user, "100000");
    await confirm(user);
    await screen.findByText("No sabemos si la recarga se aplicó");

    const [post] = deposits(backend);
    expect(post?.url).not.toContain(TOKEN);
    expect(post?.body).not.toContain(TOKEN);
    expect(post?.headers.get("Idempotency-Key")).not.toContain(TOKEN);
    expect(storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
    for (const spy of spies) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(TOKEN);
    expect(within(document.body).queryByText(TOKEN)).not.toBeInTheDocument();
  });
});
