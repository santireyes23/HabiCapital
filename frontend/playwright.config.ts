/**
 * Pruebas de extremo a extremo contra FastAPI y PostgreSQL REALES, en un entorno aislado:
 * - Backend: e2e/backend.py arranca uvicorn en :8001 SOLO si la base es la local
 *   `habicapital_test` (se niega con cualquier otra) y la migra a head.
 * - Frontend: un build aparte (dist-e2e) servido con `vite preview` en :4174, con la misma CSP
 *   que la demo y el proxy /api apuntando a :8001.
 * Nunca se reutilizan servidores ya abiertos (p. ej. los de desarrollo en :8000 y :4173).
 */

import { defineConfig, devices } from "@playwright/test";

const API_PORT = 8001;
const WEB_PORT = 4174;

export default defineConfig({
  testDir: "./e2e",
  // Una sola base de pruebas compartida: las pruebas que escriben datos van en serie.
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: `http://127.0.0.1:${String(WEB_PORT)}`,
    // Sin trazas ni vídeo: contendrían los tokens de las cuentas de prueba.
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    locale: "es-CO",
    timezoneId: "America/Bogota",
  },
  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    {
      name: "movil",
      // Accesibilidad en móvil (los anchos de responsive.spec se fijan en esa prueba y los flujos
      // de dinero ya se cubren en escritorio).
      testMatch: /a11y\.spec\.ts/,
      use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } },
    },
  ],
  webServer: [
    {
      command: "uv run python frontend/e2e/backend.py serve",
      cwd: "..",
      url: `http://127.0.0.1:${String(API_PORT)}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      env: { HABICAPITAL_E2E_API_PORT: String(API_PORT) },
    },
    {
      command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${String(WEB_PORT)} --strictPort`,
      url: `http://127.0.0.1:${String(WEB_PORT)}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { HABICAPITAL_API_ORIGIN: `http://127.0.0.1:${String(API_PORT)}` },
    },
  ],
});
