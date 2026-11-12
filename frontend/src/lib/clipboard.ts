/** Leer un UUID de cuenta del portapapeles, con mensajes claros si el navegador no lo permite. */

import { isUuid } from "../api/endpoints";

export type ClipboardUuid = { ok: true; value: string } | { ok: false; message: string };

export const CLIPBOARD_UNSUPPORTED =
  "Tu navegador no permite leer el portapapeles desde aquí. Pega el UUID manualmente (Ctrl+V).";
export const CLIPBOARD_DENIED =
  "No se concedió permiso para leer el portapapeles. Pega el UUID manualmente (Ctrl+V).";
export const CLIPBOARD_NOT_UUID = "El portapapeles no contiene un UUID de cuenta válido.";

export async function readUuidFromClipboard(): Promise<ClipboardUuid> {
  // readText no existe en navegadores sin soporte o fuera de contextos seguros.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (navigator.clipboard?.readText === undefined) return { ok: false, message: CLIPBOARD_UNSUPPORTED };
  try {
    const text = (await navigator.clipboard.readText()).trim();
    return isUuid(text) ? { ok: true, value: text } : { ok: false, message: CLIPBOARD_NOT_UUID };
  } catch {
    return { ok: false, message: CLIPBOARD_DENIED };
  }
}
