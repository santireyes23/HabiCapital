import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createIdempotencyManager, PENDING_OPERATIONS_STORAGE_KEY } from "../../api/idempotency";
import { TOKEN_STORAGE_KEY } from "../../session/tokenStore";
import { deferred, fakeBackend, networkDown } from "../../test/fakeBackend";
import { jsonResponse, type RecordedRequest } from "../../test/http";
import { newTabStorage, renderApp } from "../../test/renderApp";
import { transferScope } from "./transfer";

const TOKEN = "sendTok_Zx9abcDEF123ghiJKL456mnoPQR789stuVW";
const OTHER_TOKEN = "otherTok_Qw7ertyUIOP456asdfGHJ789zxcvBNm";

function setup(balance = 500_000) {
  const backend = fakeBackend();
  const account = backend.addAccount(TOKEN, "Camilo Aristizábal", balance);
  const recipient = backend.addAccount(OTHER_TOKEN, "Valentina Gómez", 0);
  const storage = newTabStorage();
  storage.session.set(TOKEN_STORAGE_KEY, TOKEN);
  return { backend, account, recipient, storage };
}

async function openSend(options: { balance?: number; timeoutMs?: number } = {}) {
  const ctx = setup(options.balance);
  const view = renderApp({
    path: "/enviar",
    backend: ctx.backend,
    storage: ctx.storage,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  await screen.findByRole("heading", { name: "Detalles de la transferencia" });
  return { ...ctx, ...view };
}

type User = ReturnType<typeof renderApp>["user"];
const recipientInput = () => screen.getByLabelText(/UUID de la cuenta destino/);
const amountInput = () => screen.getByLabelText(/Monto en pesos colombianos/);
const descriptionInput = () => screen.getByLabelText(/Descripción \/ motivo/);
const transfers = (backend: ReturnType<typeof fakeBackend>) => backend.requestsTo("/accounts/me/transfers", "POST");
const keyOf = (request: RecordedRequest | undefined) => request?.headers.get("Idempotency-Key");

async function fill(user: User, recipient: string, amount: string, description = "") {
  await user.clear(recipientInput());
  if (recipient !== "") await user.type(recipientInput(), recipient);
  await user.clear(amountInput());
  if (amount !== "") await user.type(amountInput(), amount);
  await user.clear(descriptionInput());
  if (description !== "") await user.type(descriptionInput(), description);
}

async function review(user: User) {
  await user.click(screen.getByRole("button", { name: "Revisar transferencia" }));
}

async function reachConfirm(user: User, recipient: string, amount: string, description = "") {
  await fill(user, recipient, amount, description);
  await review(user);
  await screen.findByText("Paso 2 de 2: Confirmar");
}

const confirm = (user: User) => user.click(screen.getByRole("button", { name: "Confirmar transferencia" }));

describe("enviar dinero: validación", () => {
  it.each([
    ["", "Ingresa el UUID de la cuenta destino."],
    ["4f9b2d8e-17c3-4d62-a58f", "El UUID debe tener 36 caracteres"],
    ["no-es-un-uuid-xxxxxxxxxxxxxxxxxxxxxxx", "El UUID debe tener 36 caracteres"],
  ])("UUID inválido «%s»", async (value, message) => {
    const { user, backend } = await openSend();
    await fill(user, value, "1000");
    await review(user);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(recipientInput()).toHaveAttribute("aria-invalid", "true");
    expect(transfers(backend)).toHaveLength(0);
  });

  it("no permite transferir a la propia cuenta", async () => {
    const { user, account, backend } = await openSend();
    await fill(user, account.id.toUpperCase(), "1000");
    await review(user);
    expect(screen.getByRole("alert")).toHaveTextContent("No puedes transferirte a tu propia cuenta.");
    expect(transfers(backend)).toHaveLength(0);
  });

  it.each([
    ["", "Ingresa un monto."],
    ["0", "El monto mínimo es $1 COP."],
    ["-1", "Ingresa pesos enteros, sin decimales."],
    ["1500,5", "Ingresa pesos enteros, sin decimales."],
    ["10000001", "El monto máximo es $10.000.000 COP."],
  ])("monto inválido «%s»", async (value, message) => {
    const { user, recipient } = await openSend();
    await fill(user, recipient.id, value);
    await review(user);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });

  it("descripción de más de 140 caracteres", async () => {
    const { user, recipient } = await openSend();
    await fill(user, recipient.id, "1000", "a".repeat(141));
    await review(user);
    expect(screen.getByRole("alert")).toHaveTextContent("La descripción admite máximo 140 caracteres.");
  });

  it("los sugeridos reemplazan el valor y «Todo el saldo» usa el saldo real con el tope de la API", async () => {
    const { user } = await openSend({ balance: 12_345_678 });
    await user.type(amountInput(), "999");
    await user.click(screen.getByRole("button", { name: "$20.000" }));
    expect(amountInput()).toHaveValue("20000");
    await user.click(screen.getByRole("button", { name: "$100.000" }));
    expect(amountInput()).toHaveValue("100000");
    await user.click(screen.getByRole("button", { name: "Todo el saldo" }));
    expect(amountInput()).toHaveValue("10000000");
  });

  it("«Todo el saldo» con saldo menor al tope usa el saldo exacto; sin saldo está desactivado", async () => {
    const { user } = await openSend({ balance: 37_500 });
    await user.click(screen.getByRole("button", { name: "Todo el saldo" }));
    expect(amountInput()).toHaveValue("37500");
  });

  it("sin saldo, «Todo el saldo» está desactivado", async () => {
    await openSend({ balance: 0 });
    expect(screen.getByRole("button", { name: "Todo el saldo" })).toBeDisabled();
  });

  it("avisa (sin bloquear) si el monto supera el saldo", async () => {
    const { user } = await openSend({ balance: 1_000 });
    await user.type(amountInput(), "5000");
    expect(screen.getByText(/Supera tu saldo disponible \(\$1\.000 COP\)/)).toBeInTheDocument();
  });

  it("no ofrece búsqueda de usuarios, contactos ni datos ficticios", async () => {
    await openSend();
    expect(screen.queryByText(/ejemplo/i, { selector: "button" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Probar respuestas del sistema/)).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(3);
  });
});

describe("enviar dinero: botón «Pegar»", () => {
  it("pega un UUID válido del portapapeles", async () => {
    const { user, recipient } = await openSend();
    vi.spyOn(navigator.clipboard, "readText").mockResolvedValue(`  ${recipient.id}  `);
    await user.click(screen.getByRole("button", { name: "Pegar" }));
    expect(recipientInput()).toHaveValue(recipient.id);
  });

  it("si el portapapeles no tiene un UUID, no cambia el campo", async () => {
    const { user } = await openSend();
    vi.spyOn(navigator.clipboard, "readText").mockResolvedValue("hola mundo");
    await user.type(recipientInput(), "abc");
    await user.click(screen.getByRole("button", { name: "Pegar" }));
    expect(recipientInput()).toHaveValue("abc");
    expect(screen.getByText("El portapapeles no contiene un UUID de cuenta válido.")).toBeInTheDocument();
  });

  it("si el navegador niega el permiso, explica cómo pegar a mano", async () => {
    const { user } = await openSend();
    vi.spyOn(navigator.clipboard, "readText").mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    await user.click(screen.getByRole("button", { name: "Pegar" }));
    expect(screen.getByText(/No se concedió permiso para leer el portapapeles/)).toBeInTheDocument();
  });

  it("si el navegador no permite leer el portapapeles, lo dice", async () => {
    const { user } = await openSend();
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue(undefined as unknown as Clipboard);
    await user.click(screen.getByRole("button", { name: "Pegar" }));
    expect(screen.getByText(/Tu navegador no permite leer el portapapeles/)).toBeInTheDocument();
  });
});

describe("enviar dinero: confirmación y envío", () => {
  it("confirma con UUID completo, monto, descripción, saldo real y estimado; «Editar» conserva los datos", async () => {
    const { user, recipient, backend } = await openSend({ balance: 300_000 });
    await reachConfirm(user, recipient.id, "100000", "  Almuerzo  ");

    const summary = screen.getByText("Monto de la transferencia").closest("div[aria-live]") as HTMLElement;
    expect(summary).toHaveTextContent("$100.000 COP");
    expect(summary).toHaveTextContent(recipient.id);
    expect(summary).toHaveTextContent("DescripciónAlmuerzo");
    await waitFor(() => {
      expect(summary).toHaveTextContent("Saldo actual$300.000 COP");
    });
    expect(summary).toHaveTextContent("Saldo estimado después$200.000 COP");
    expect(summary).not.toHaveTextContent("Valentina Gómez");
    expect(transfers(backend)).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Editar" }));
    expect(recipientInput()).toHaveValue(recipient.id);
    expect(amountInput()).toHaveValue("100000");
    expect(descriptionInput()).toHaveValue("Almuerzo");
  });

  it("éxito: un POST con Bearer e Idempotency-Key, resultado real, saldo actualizado y toast", async () => {
    const { user, recipient, backend, storage } = await openSend({ balance: 300_000 });
    await reachConfirm(user, recipient.id, "100000", "Almuerzo");
    await confirm(user);

    expect(await screen.findByRole("heading", { name: "Transferencia completada" })).toBeInTheDocument();
    const [post] = transfers(backend);
    expect(post?.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(keyOf(post)).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(post?.body ?? "{}")).toEqual({ to_account_id: recipient.id, amount: 100_000, description: "Almuerzo" });

    const section = screen.getByRole("region", { name: "Detalles de la transferencia" });
    expect(section).toHaveTextContent("Monto transferido-$100.000 COP");
    expect(section).toHaveTextContent(recipient.id);
    expect(section).toHaveTextContent("Saldo restante$200.000 COP");
    expect(screen.getByText("Saldo disponible").parentElement).toHaveTextContent("$200.000 COP");
    const toast = screen.getByText("Transacción completada").closest("aside");
    expect(toast).toHaveTextContent(`Se transfirieron $100.000 COP a la cuenta ${recipient.id.replaceAll("-", "").slice(0, 4)}`);
    expect(storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).toBeNull();
    expect(recipient.balance).toBe(100_000);

    await user.click(screen.getByRole("button", { name: "Hacer otra transferencia" }));
    expect(recipientInput()).toHaveValue("");
  });

  it("sin descripción, el cuerpo no incluye el campo", async () => {
    const { user, recipient, backend } = await openSend();
    await reachConfirm(user, recipient.id, "1000");
    await confirm(user);
    await screen.findByRole("heading", { name: "Transferencia completada" });
    expect(JSON.parse(transfers(backend)[0]?.body ?? "{}")).toEqual({ to_account_id: recipient.id, amount: 1_000 });
  });

  it("«Volver a Inicio» muestra la transferencia en los movimientos (consultados de nuevo)", async () => {
    const { user, recipient } = await openSend();
    await reachConfirm(user, recipient.id, "45000");
    await confirm(user);
    await screen.findByRole("heading", { name: "Transferencia completada" });
    await user.click(screen.getByRole("link", { name: "Volver a Inicio" }));
    // Inicio se carga aparte (carga diferida): primero se espera a que esté en pantalla.
    await screen.findByRole("heading", { name: "Tu dinero, en movimiento." });
    expect(await screen.findByText("-$45.000 COP")).toBeInTheDocument();
    expect(screen.getByText("Valentina Gómez")).toBeInTheDocument();
  });

  it("respuesta repetida: «Esta transferencia ya se había realizado»", async () => {
    const { user, recipient, backend } = await openSend();
    backend.nextFor("POST", "/accounts/me/transfers", () =>
      jsonResponse(
        201,
        {
          transaction_id: "eeeeeeee-0000-4000-8000-000000000099",
          to_account_id: recipient.id,
          amount: 1_000,
          description: null,
          balance: 499_000,
          created_at: "2026-11-12T17:00:00+00:00",
        },
        { "Idempotent-Replayed": "true" },
      ),
    );
    await reachConfirm(user, recipient.id, "1000");
    await confirm(user);
    expect(await screen.findByRole("heading", { name: "Esta transferencia ya se había realizado" })).toBeInTheDocument();
  });

  it("un doble clic no produce dos transferencias", async () => {
    const { user, recipient, backend } = await openSend();
    const pending = deferred();
    backend.nextFor("POST", "/accounts/me/transfers", pending.responder);
    await reachConfirm(user, recipient.id, "1000");
    await confirm(user);
    const busy = screen.getByRole("button", { name: "Procesando transferencia…" });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(transfers(backend)).toHaveLength(1);
    pending.release(
      jsonResponse(201, {
        transaction_id: "eeeeeeee-0000-4000-8000-000000000098",
        to_account_id: recipient.id,
        amount: 1_000,
        description: null,
        balance: 499_000,
        created_at: "2026-11-12T17:00:00+00:00",
      }),
    );
    expect(await screen.findByRole("heading", { name: "Transferencia completada" })).toBeInTheDocument();
    expect(transfers(backend)).toHaveLength(1);
  });
});

describe("enviar dinero: errores definitivos", () => {
  it("409 saldo insuficiente: mensaje real del backend, datos conservados y nada pendiente", async () => {
    const { user, recipient, storage, account } = await openSend({ balance: 1_000 });
    await reachConfirm(user, recipient.id, "5000");
    await confirm(user);
    const alert = await screen.findByText("No se realizó la transferencia");
    expect(alert.closest("[role=alert]")).toHaveTextContent("Saldo insuficiente");
    expect(amountInput()).toHaveValue("5000");
    expect(storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).toBeNull();
    expect(account.balance).toBe(1_000);
  });

  it("404 destinatario inexistente: error en el campo del UUID", async () => {
    const { user } = await openSend();
    await reachConfirm(user, "4f9b2d8e-17c3-4d62-a58f-90e8c71b3e21", "1000");
    await confirm(user);
    expect(await screen.findByText("Cuenta de destino no encontrada")).toBeInTheDocument();
    expect(recipientInput()).toHaveAttribute("aria-invalid", "true");
  });

  it("422 de negocio (propia cuenta según el servidor): muestra el mensaje real", async () => {
    const { user, recipient, backend } = await openSend();
    backend.nextFor("POST", "/accounts/me/transfers", () =>
      jsonResponse(422, { detail: "No puedes transferirte a tu propia cuenta" }),
    );
    await reachConfirm(user, recipient.id, "1000");
    await confirm(user);
    const alert = await screen.findByText("No se realizó la transferencia");
    expect(alert.closest("[role=alert]")).toHaveTextContent("No puedes transferirte a tu propia cuenta");
  });

  it("422 de validación de FastAPI: error junto al campo", async () => {
    const { user, recipient, backend } = await openSend();
    backend.nextFor("POST", "/accounts/me/transfers", () =>
      jsonResponse(422, { detail: [{ loc: ["body", "description"], msg: "too long", type: "x" }] }),
    );
    await reachConfirm(user, recipient.id, "1000", "Hola");
    await confirm(user);
    expect(await screen.findByText(/El servidor no aceptó la descripción/)).toBeInTheDocument();
  });

  it("400: muestra el detalle del servidor", async () => {
    const { user, recipient, backend } = await openSend();
    backend.nextFor("POST", "/accounts/me/transfers", () => jsonResponse(400, { detail: "Solicitud inválida" }));
    await reachConfirm(user, recipient.id, "1000");
    await confirm(user);
    const alert = await screen.findByText("No se realizó la transferencia");
    expect(alert.closest("[role=alert]")).toHaveTextContent("Solicitud inválida");
  });

  it("401: la sesión termina y lleva a «Acceder»", async () => {
    const { user, recipient, backend, storage } = await openSend();
    backend.accounts.delete(TOKEN);
    await reachConfirm(user, recipient.id, "1000").catch(() => undefined);
    if (screen.queryByRole("button", { name: "Confirmar transferencia" }) !== null) await confirm(user);
    expect(await screen.findByText("Tu sesión terminó")).toBeInTheDocument();
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBeNull();
  });
});

describe("enviar dinero: resultados inciertos y recuperación", () => {
  it.each([
    ["error de red", () => networkDown],
    ["error 5xx", () => () => jsonResponse(502, { detail: "Bad Gateway" })],
    ["respuesta 2xx ilegible", () => () => jsonResponse(201, { ok: true })],
  ])("%s: «No sabemos si la transferencia se realizó», sin reintento automático", async (_name, responder) => {
    const { user, recipient, backend } = await openSend();
    backend.nextFor("POST", "/accounts/me/transfers", responder());
    await reachConfirm(user, recipient.id, "1000");
    await confirm(user);
    expect(await screen.findByText("No sabemos si la transferencia se realizó")).toBeInTheDocument();
    expect(transfers(backend)).toHaveLength(1);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("timeout: el reintento manual usa la misma clave y exactamente el mismo contenido", async () => {
    const { user, recipient, backend, account } = await openSend({ timeoutMs: 50 });
    backend.nextFor("POST", "/accounts/me/transfers", (request) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
    );
    await reachConfirm(user, recipient.id, "1000", "Pago");
    await confirm(user);
    expect(await screen.findByText("No sabemos si la transferencia se realizó")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("El servidor tardó demasiado en responder.");

    await user.click(screen.getByRole("button", { name: "Reintentar con la misma clave" }));
    expect(await screen.findByRole("heading", { name: "Transferencia completada" })).toBeInTheDocument();
    const [first, second] = transfers(backend);
    expect(keyOf(second)).toBe(keyOf(first));
    expect(second?.body).toBe(first?.body);
    expect(account.balance).toBe(499_000);
  });

  it("si la primera sí se realizó, el reintento no envía el dinero dos veces", async () => {
    const { user, recipient, backend, account } = await openSend();
    backend.nextFor("POST", "/accounts/me/transfers", async (request) => {
      await backend.fetchFn("/api/accounts/me/transfers", { method: "POST", headers: request.headers, body: request.body });
      throw new TypeError("Failed to fetch");
    });
    await reachConfirm(user, recipient.id, "1000");
    await confirm(user);
    await screen.findByText("No sabemos si la transferencia se realizó");
    expect(recipient.balance).toBe(1_000);

    await user.click(screen.getByRole("button", { name: "Reintentar con la misma clave" }));
    expect(await screen.findByRole("heading", { name: "Esta transferencia ya se había realizado" })).toBeInTheDocument();
    expect(recipient.balance).toBe(1_000);
    expect(account.balance).toBe(499_000);
  });

  it("tras recargar la página recupera la transferencia pendiente con sus datos y la misma clave", async () => {
    const ctx = await openSend();
    ctx.backend.nextFor("POST", "/accounts/me/transfers", networkDown);
    await reachConfirm(ctx.user, ctx.recipient.id, "1000", "Pago");
    await confirm(ctx.user);
    await screen.findByText("No sabemos si la transferencia se realizó");
    ctx.unmount();

    const second = renderApp({ path: "/enviar", backend: ctx.backend, storage: ctx.storage });
    expect(await screen.findByText(/Hay una transferencia de esta sesión sin respuesta confirmada/)).toBeInTheDocument();
    const summary = screen.getByText("Monto pendiente").closest(".rounded-card") as HTMLElement;
    expect(summary).toHaveTextContent("$1.000 COP");
    expect(summary).toHaveTextContent(ctx.recipient.id);
    expect(summary).toHaveTextContent("Pago");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/no se puede iniciar otra distinta/)).toBeInTheDocument();

    await second.user.click(screen.getByRole("button", { name: "Reintentar con la misma clave" }));
    expect(await screen.findByRole("heading", { name: "Transferencia completada" })).toBeInTheDocument();
    const [first, retry] = transfers(ctx.backend);
    expect(keyOf(retry)).toBe(keyOf(first));
    expect(retry?.body).toBe(first?.body);
  });

  it("con una transferencia pendiente no se puede iniciar otra distinta", async () => {
    const ctx = setup();
    createIdempotencyManager({ store: ctx.storage.operations }).begin(transferScope(ctx.account.id), {
      to_account_id: ctx.recipient.id,
      amount: 7_000,
    });
    renderApp({ path: "/enviar", backend: ctx.backend, storage: ctx.storage });
    expect(await screen.findByText("No sabemos si la transferencia se realizó")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revisar transferencia" })).not.toBeInTheDocument();
    expect(transfers(ctx.backend)).toHaveLength(0);
  });

  it("descartar exige confirmación y explica que no cancela ni revierte nada", async () => {
    const { user, recipient, backend, storage } = await openSend();
    backend.nextFor("POST", "/accounts/me/transfers", networkDown);
    await reachConfirm(user, recipient.id, "1000");
    await confirm(user);
    await screen.findByText("No sabemos si la transferencia se realizó");
    const firstKey = keyOf(transfers(backend)[0]);

    await user.click(screen.getByRole("button", { name: "Dejar de intentar recuperar" }));
    expect(screen.getByText(/no cancela ni revierte/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Volver" }));
    expect(storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Dejar de intentar recuperar" }));
    await user.click(screen.getByRole("button", { name: "Sí, dejar de intentar recuperar" }));
    expect(screen.getByText("Se descartó la información local")).toBeInTheDocument();
    expect(storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).toBeNull();
    expect(screen.queryByText(/Cancelar transferencia/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Nueva transferencia" }));
    await reachConfirm(user, recipient.id, "2000");
    await confirm(user);
    await screen.findByRole("heading", { name: "Transferencia completada" });
    expect(keyOf(transfers(backend)[1])).not.toBe(firstKey);
  });
});

describe("enviar dinero: credenciales", () => {
  it("el token no aparece en cuerpo, URL, clave, datos guardados, DOM ni consola", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const { user, recipient, backend, storage } = await openSend();
    backend.nextFor("POST", "/accounts/me/transfers", networkDown);
    await reachConfirm(user, recipient.id, "1000", "Pago");
    await confirm(user);
    await screen.findByText("No sabemos si la transferencia se realizó");

    const [post] = transfers(backend);
    expect(post?.url).not.toContain(TOKEN);
    expect(post?.body).not.toContain(TOKEN);
    expect(keyOf(post)).not.toContain(TOKEN);
    expect(storage.operations.get(PENDING_OPERATIONS_STORAGE_KEY)).not.toContain(TOKEN);
    expect(document.body.innerHTML).not.toContain(TOKEN);
    for (const spy of spies) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(TOKEN);
    expect(within(document.body).queryByText(TOKEN)).not.toBeInTheDocument();
  });
});
