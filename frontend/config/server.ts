/**
 * Configuración del servidor de desarrollo y de `vite preview`, separada de vite.config.ts para
 * poder probarla. No se empaqueta en la aplicación.
 */

/** Prefijo con el que el navegador llama a la API: el proxy lo quita antes de reenviar. */
export const API_PREFIX = "/api";

/** Dónde escucha FastAPI en local (`uv run uvicorn habicapital.main:app`). */
export const DEFAULT_API_ORIGIN = "http://127.0.0.1:8000";

/** Quita el prefijo /api: /api/accounts/me -> /accounts/me. Otras rutas no se tocan. */
export function stripApiPrefix(path: string): string {
  if (path === API_PREFIX) return "/";
  return path.startsWith(`${API_PREFIX}/`) || path.startsWith(`${API_PREFIX}?`)
    ? path.slice(API_PREFIX.length)
    : path;
}

/** Acepta solo http(s) con host: evita reenviar a destinos mal escritos. */
export function resolveApiOrigin(value: string | undefined): string {
  if (value === undefined || value.trim() === "") return DEFAULT_API_ORIGIN;
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("HABICAPITAL_API_ORIGIN debe empezar por http:// o https://");
  }
  return url.origin;
}

export function apiProxy(target: string) {
  return {
    [API_PREFIX]: {
      target,
      changeOrigin: true,
      rewrite: stripApiPrefix,
    },
  };
}

/**
 * Cabeceras de seguridad para `vite preview` (el build que se demuestra). En `vite dev` no se
 * aplica la CSP: el recargado en caliente de React necesita un script en línea.
 * Todo se sirve desde el mismo origen: scripts, estilos, fuentes (Manrope autoalojada) y la API
 * (a través del proxy). No hay recursos externos.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  // La aplicación no usa cámara, micrófono, ubicación ni pagos del navegador: se deshabilitan.
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  // Aísla la ventana de otras que la abran (window.opener).
  "Cross-Origin-Opener-Policy": "same-origin",
};
