/**
 * Copiar al portapapeles con navigator.clipboard (sin mecanismos obsoletos). Si el navegador lo
 * niega o no existe, devuelve "failed" y quien llama selecciona el texto para copiarlo a mano.
 * El valor copiado nunca se registra.
 */

import { useCallback, useEffect, useState } from "react";

export type CopyState = "idle" | "copied" | "failed";

export function useCopy(resetAfterMs = 2_000) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => {
      setState("idle");
    }, resetAfterMs);
    return () => {
      clearTimeout(timer);
    };
  }, [resetAfterMs, state]);

  const copy = useCallback(async (value: string): Promise<boolean> => {
    try {
      // navigator.clipboard no existe fuera de contextos seguros: se trata como un fallo.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (navigator.clipboard === undefined) throw new Error("sin portapapeles");
      await navigator.clipboard.writeText(value);
      setState("copied");
      return true;
    } catch {
      setState("failed");
      return false;
    }
  }, []);

  return { state, copy };
}

/** Selecciona el contenido de un elemento para que el usuario lo copie a mano. */
export function selectContents(node: HTMLElement | null): void {
  const selection = window.getSelection();
  if (node === null || selection === null) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
}
