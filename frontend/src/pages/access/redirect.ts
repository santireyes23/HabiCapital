/**
 * Destino al que volver después de iniciar sesión. Llega en el estado de navegación que deja la
 * ruta protegida (`{ from: "/movimientos" }`): solo una ruta interna, nunca datos de la sesión.
 */

const PROTECTED_PREFIXES = ["/", "/enviar", "/recargar", "/solicitudes", "/movimientos", "/cuenta"];

export interface AccessLocationState {
  from?: string;
}

/** Devuelve la ruta solo si es interna y protegida; descarta URLs externas y «//host». */
export function safeRedirectPath(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  const from = (state as AccessLocationState).from;
  if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//")) return null;
  if (from.includes("\\")) return null;
  const pathname = from.split(/[?#]/)[0] ?? "";
  if (pathname === "/acceso") return null;
  const known = PROTECTED_PREFIXES.some((prefix) =>
    prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return known ? from : null;
}
