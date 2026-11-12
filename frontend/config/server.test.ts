// @vitest-environment node
import { describe, expect, it } from "vitest";

import viteConfig from "../vite.config";
import {
  API_PREFIX,
  apiProxy,
  CONTENT_SECURITY_POLICY,
  DEFAULT_API_ORIGIN,
  resolveApiOrigin,
  SECURITY_HEADERS,
  stripApiPrefix,
} from "./server";

describe("proxy hacia FastAPI", () => {
  it.each([
    ["/api/health", "/health"],
    ["/api/accounts/me", "/accounts/me"],
    ["/api/money-requests?role=sent", "/money-requests?role=sent"],
    ["/api", "/"],
    ["/apix/otra", "/apix/otra"],
    ["/assets/app.js", "/assets/app.js"],
  ])("%s -> %s", (path, expected) => {
    expect(stripApiPrefix(path)).toBe(expected);
  });

  it("apunta por defecto a uvicorn en local", () => {
    expect(resolveApiOrigin(undefined)).toBe(DEFAULT_API_ORIGIN);
    expect(resolveApiOrigin("")).toBe(DEFAULT_API_ORIGIN);
    expect(DEFAULT_API_ORIGIN).toBe("http://127.0.0.1:8000");
  });

  it("acepta otro origen http(s) y rechaza el resto", () => {
    expect(resolveApiOrigin("http://localhost:9000/ruta")).toBe("http://localhost:9000");
    expect(() => resolveApiOrigin("file:///etc/passwd")).toThrow();
    expect(() => resolveApiOrigin("no es url")).toThrow();
  });

  it("solo hay una regla de proxy, la de /api", () => {
    const proxy = apiProxy("http://127.0.0.1:8000");
    expect(Object.keys(proxy)).toEqual([API_PREFIX]);
    expect(proxy[API_PREFIX]).toMatchObject({ target: "http://127.0.0.1:8000", changeOrigin: true });
  });
});

describe("configuración de Vite", () => {
  it("dev y preview usan el mismo proxy; preview añade las cabeceras de seguridad", () => {
    expect(Object.keys(viteConfig.server?.proxy ?? {})).toEqual([API_PREFIX]);
    expect(viteConfig.preview?.proxy).toBe(viteConfig.server?.proxy);
    expect(viteConfig.preview?.headers).toEqual(SECURITY_HEADERS);
    expect(viteConfig.server?.headers).toBeUndefined();
  });

  it("nunca incrusta fuentes como data: (la CSP las bloquearía)", () => {
    const inline = viteConfig.build?.assetsInlineLimit;
    expect(typeof inline).toBe("function");
    if (typeof inline !== "function") return;
    const empty = Buffer.alloc(0);
    expect(inline("/x/manrope-latin-ext-wght-normal.woff2", empty)).toBe(false);
    expect(inline("/x/manrope.woff", empty)).toBe(false);
    expect(inline("/x/icono.svg", empty)).toBeUndefined();
  });

  it("escucha solo en la máquina local y no publica source maps", () => {
    expect(viteConfig.server?.host).toBe("127.0.0.1");
    expect(viteConfig.preview?.host).toBe("127.0.0.1");
    expect(viteConfig.build?.sourcemap).toBe(false);
  });
});

describe("Content-Security-Policy", () => {
  const directives = Object.fromEntries(
    CONTENT_SECURITY_POLICY.split("; ").map((d) => {
      const [name = "", ...values] = d.split(" ");
      return [name, values];
    }),
  );

  it("todo desde el mismo origen: sin scripts, estilos ni fuentes externas", () => {
    for (const name of ["default-src", "script-src", "style-src", "font-src", "connect-src"]) {
      expect(directives[name]).toEqual(["'self'"]);
    }
  });

  it("no permite código en línea ni eval", () => {
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-inline|unsafe-eval|https?:/);
  });

  it("bloquea objetos, marcos y cambios de base", () => {
    expect(directives["object-src"]).toEqual(["'none'"]);
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
    expect(directives["base-uri"]).toEqual(["'self'"]);
  });
});
