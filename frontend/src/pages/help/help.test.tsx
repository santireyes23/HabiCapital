import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TOKEN_STORAGE_KEY } from "../../session/tokenStore";
import { fakeBackend } from "../../test/fakeBackend";
import { newTabStorage, renderApp } from "../../test/renderApp";
import { FAQ } from "./faq";

const TOKEN = "helpTok_Zx9abcDEF123ghiJKL456mnoPQR789stuVWx";

function withSession() {
  const backend = fakeBackend();
  backend.addAccount(TOKEN, "Camilo Aristizábal", 10_000);
  const storage = newTabStorage();
  storage.session.set(TOKEN_STORAGE_KEY, TOKEN);
  return { backend, storage };
}

const location = () => screen.getByTestId("location").textContent;
const helpHeading = () => screen.findByRole("heading", { level: 1, name: "Centro de ayuda" });
const sidebar = () => screen.getAllByRole("navigation", { name: "Navegación principal" })[0] as HTMLElement;

describe("Centro de ayuda: acceso", () => {
  it("es pública: se ve sin sesión, sin llamar a la API y con enlace a /acceso", async () => {
    const { backend } = renderApp({ path: "/ayuda" });
    expect(await helpHeading()).toBeInTheDocument();
    expect(screen.getByText("Encuentra respuestas a las preguntas más frecuentes sobre HabiCapital.")).toBeInTheDocument();
    expect(screen.getByText(/HabiCapital usa dinero simulado/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear cuenta o acceder" })).toHaveAttribute("href", "/acceso");
    expect(screen.queryByRole("navigation", { name: "Navegación principal" })).not.toBeInTheDocument();
    expect(backend.apiRequests()).toHaveLength(0);
  });

  it("se abre desde la pantalla de acceso con «¿Necesitas ayuda?»", async () => {
    const { user } = renderApp({ path: "/acceso" });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });
    await user.click(screen.getByRole("link", { name: "¿Necesitas ayuda?" }));
    expect(await helpHeading()).toBeInTheDocument();
    expect(location()).toBe("/ayuda");
  });

  it("las rutas privadas siguen protegidas", async () => {
    renderApp({ path: "/movimientos" });
    await waitFor(() => {
      expect(location()).toBe("/acceso");
    });
  });

  it("con sesión, «Ayuda» del menú lateral la abre dentro del panel sin perder la sesión", async () => {
    const ctx = withSession();
    const { user, backend, storage } = renderApp({ path: "/", ...ctx });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });
    await user.click(within(sidebar()).getByRole("link", { name: "Ayuda" }));
    expect(await helpHeading()).toBeInTheDocument();
    expect(location()).toBe("/ayuda");
    expect(within(sidebar()).getByRole("link", { name: "Ayuda" })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByText("Camilo Aristizábal").length).toBeGreaterThan(0);
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBe(TOKEN);
    expect(backend.requestsTo("/accounts/me/token")).toHaveLength(0);

    await user.click(within(sidebar()).getByRole("link", { name: "Movimientos" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Mis movimientos" })).toBeInTheDocument();
    expect(storage.session.get(TOKEN_STORAGE_KEY)).toBe(TOKEN);
  });

  it("con sesión, también se abre desde el menú móvil", async () => {
    const ctx = withSession();
    const { user } = renderApp({ path: "/", ...ctx });
    await screen.findByRole("heading", { level: 1, name: "Tu dinero, en movimiento." });
    await user.click(screen.getByRole("button", { name: "Menú" }));
    const menu = document.getElementById("mobile-menu") as HTMLElement;
    await user.click(within(menu).getByRole("link", { name: "Ayuda" }));
    expect(await helpHeading()).toBeInTheDocument();
    expect(document.getElementById("mobile-menu")).toBeNull();
  });

  it("al entrar directamente a /ayuda con un token guardado, lo valida y muestra el panel", async () => {
    const ctx = withSession();
    renderApp({ path: "/ayuda", ...ctx });
    expect(await helpHeading()).toBeInTheDocument();
    expect(screen.getAllByRole("navigation", { name: "Navegación principal" }).length).toBeGreaterThan(0);
    expect(ctx.storage.session.get(TOKEN_STORAGE_KEY)).toBe(TOKEN);
  });
});

describe("Centro de ayuda: preguntas", () => {
  it("cuatro categorías con sus preguntas, y un índice que enlaza a cada una", async () => {
    renderApp({ path: "/ayuda" });
    await helpHeading();
    const titles = FAQ.map((category) => category.title);
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(titles);
    const index = screen.getByRole("navigation", { name: "Categorías de ayuda" });
    for (const category of FAQ) {
      const link = within(index).getByRole("link", { name: category.title });
      expect(document.getElementById(link.getAttribute("href")?.slice(1) ?? "")).not.toBeNull();
    }
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(FAQ.flatMap((category) => category.items).length);
  });

  it("acordeón: abre y cierra con clic, y con el teclado (Enter y espacio)", async () => {
    const { user } = renderApp({ path: "/ayuda" });
    await helpHeading();
    const question = screen.getByRole("button", { name: "¿Qué es un token de acceso y para qué sirve?" });
    const panel = document.getElementById(question.getAttribute("aria-controls") ?? "") as HTMLElement;
    expect(question).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toBeVisible();

    await user.click(question);
    expect(question).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    expect(within(panel).getByText(/No es lo mismo que el UUID/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "¿Qué es un token de acceso y para qué sirve?" })).toBe(panel);

    await user.click(question);
    expect(question).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toBeVisible();

    question.focus();
    await user.keyboard("{Enter}");
    expect(question).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(question).toHaveAttribute("aria-expanded", "false");
  });

  it("varias respuestas pueden estar abiertas a la vez; los pasos se muestran numerados", async () => {
    const { user } = renderApp({ path: "/ayuda" });
    await helpHeading();
    const create = screen.getByRole("button", { name: "¿Cómo creo una cuenta en HabiCapital?" });
    const login = screen.getByRole("button", { name: "¿Cómo inicio sesión?" });
    await user.click(create);
    await user.click(login);
    expect(create).toHaveAttribute("aria-expanded", "true");
    expect(login).toHaveAttribute("aria-expanded", "true");
    const steps = within(screen.getByRole("region", { name: "¿Cómo inicio sesión?" })).getAllByRole("listitem");
    expect(steps[0]).toHaveTextContent("1En la pantalla de acceso, elige la pestaña «Ya tengo cuenta».");
    expect(steps).toHaveLength(4);
  });

  it("accesibilidad básica: cada pregunta es un botón dentro de un h3 que controla su región", async () => {
    renderApp({ path: "/ayuda" });
    await helpHeading();
    for (const item of FAQ.flatMap((category) => category.items)) {
      const button = screen.getByRole("button", { name: item.question });
      expect(button.closest("h3")).not.toBeNull();
      const panel = document.getElementById(button.getAttribute("aria-controls") ?? "");
      expect(panel).toHaveAttribute("role", "region");
      expect(panel).toHaveAttribute("aria-labelledby", button.id);
    }
  });
});
