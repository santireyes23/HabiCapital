import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/errors";
import { Brand } from "./Brand";
import { ServerStatusBadge } from "./ServerStatusBadge";

// Pruebas de la etapa 1 (antes en App.test.tsx): el marcador de salud y la marca pasaron a sus
// propios componentes; las aserciones son las mismas.
describe("ServerStatusBadge y marca (etapa 1)", () => {
  it("muestra el servidor conectado solo cuando GET /health responde ok", async () => {
    const checkHealth = vi.fn(() =>
      Promise.resolve({ data: { status: "ok" }, status: 200, replayed: false }),
    );
    render(<ServerStatusBadge checkHealth={checkHealth} />);

    expect(screen.getByRole("status")).toHaveTextContent("Comprobando servidor");
    expect(await screen.findByText("Servidor FastAPI conectado")).toBeInTheDocument();
    expect(checkHealth).toHaveBeenCalledOnce();
  });

  it("muestra el servidor no disponible si la llamada falla", async () => {
    const checkHealth = vi.fn(() => Promise.reject(new ApiError("network", "sin red")));
    render(<ServerStatusBadge checkHealth={checkHealth} />);

    expect(await screen.findByText("Servidor no disponible")).toBeInTheDocument();
  });

  it("muestra la marca con los colores del diseño", () => {
    render(<Brand />);
    expect(screen.getByText("Capital")).toHaveClass("text-accent");
  });
});
