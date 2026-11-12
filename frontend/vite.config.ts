/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

import { apiProxy, resolveApiOrigin, SECURITY_HEADERS } from "./config/server.ts";

const proxy = apiProxy(resolveApiOrigin(process.env.HABICAPITAL_API_ORIGIN));

// Versión real del frontend (package.json), para «Versión cliente» en Mi cuenta.
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy,
    headers: SECURITY_HEADERS,
  },
  build: {
    // Sin source maps en el build: no se publica el código fuente junto a la demo.
    sourcemap: false,
    // Las fuentes siempre como archivo: la CSP (font-src 'self') no admite fuentes en data:.
    assetsInlineLimit: (file) => (file.endsWith(".woff2") || file.endsWith(".woff") ? false : undefined),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "config/**/*.test.ts"],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
