import { describe, expect, it } from "vitest";

import { formatDate, formatDateTime, formatTime } from "./dates";

// 12 nov 2026, 10:00 a. m. en Bogotá (UTC-5).
const NOW = new Date("2026-11-12T15:00:00Z");

describe("fechas en hora de Colombia", () => {
  it("convierte la hora UTC del backend a Bogotá (UTC-5)", () => {
    expect(formatTime("2026-11-12T15:45:00+00:00")).toBe("10:45 AM");
    expect(formatTime("2026-11-11T23:15:00Z")).toBe("06:15 PM");
  });

  it("hoy, ayer y otros días con el estilo del diseño", () => {
    expect(formatDateTime("2026-11-12T15:45:00Z", NOW)).toBe("Hoy, 10:45 AM");
    expect(formatDateTime("2026-11-11T21:30:00Z", NOW)).toBe("Ayer, 04:30 PM");
    expect(formatDateTime("2026-11-10T18:20:00Z", NOW)).toBe("10 Nov, 01:20 PM");
  });

  it("el cambio de día se calcula en Bogotá, no en UTC", () => {
    // 03:00 UTC del 12 = 10:00 p. m. del 11 en Bogotá: es «ayer».
    expect(formatDateTime("2026-11-12T03:00:00Z", NOW)).toBe("Ayer, 10:00 PM");
  });

  it("fecha sin hora", () => {
    expect(formatDate("2026-11-10T18:20:00Z")).toBe("10 Nov, 2026");
  });

  it("rechaza fechas inválidas", () => {
    expect(() => formatDate("no es fecha")).toThrow("Fecha inválida");
  });
});
