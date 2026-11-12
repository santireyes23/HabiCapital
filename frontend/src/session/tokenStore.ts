/**
 * Dónde vive el token Bearer en el navegador.
 *
 * - En memoria y en sessionStorage: sobrevive a una recarga de la pestaña y se borra al
 *   cerrarla. Nunca en localStorage, cookies, URL ni logs.
 * - El token solo se lee para ponerlo en la cabecera Authorization (ver api/client.ts).
 */

import { browserSessionStore, type KeyValueStore } from "../lib/safeStorage";

export const TOKEN_STORAGE_KEY = "habicapital.session.token";

/** El backend emite tokens URL-safe (secrets.token_urlsafe): solo ASCII visible, sin espacios. */
const TOKEN_PATTERN = /^[\x21-\x7E]{1,512}$/;

export function isPlausibleToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export interface TokenStore {
  get(): string | null;
  /** Guarda el token (sin espacios alrededor). Lanza si el formato no es válido. */
  set(token: string): void;
  clear(): void;
  /** Aviso de cambios (iniciar o cerrar sesión). Devuelve la función para dejar de escuchar. */
  subscribe(listener: () => void): () => void;
}

export function createTokenStore(store: KeyValueStore = browserSessionStore()): TokenStore {
  const listeners = new Set<() => void>();
  let current: string | null = null;

  const stored = store.get(TOKEN_STORAGE_KEY);
  if (stored !== null && isPlausibleToken(stored)) current = stored;
  else if (stored !== null) store.remove(TOKEN_STORAGE_KEY);

  function notify() {
    for (const listener of listeners) listener();
  }

  return {
    get: () => current,
    set(token) {
      const value = token.trim();
      // El mensaje no repite el valor recibido.
      if (!isPlausibleToken(value)) throw new Error("El token no tiene un formato válido");
      current = value;
      store.set(TOKEN_STORAGE_KEY, value);
      notify();
    },
    clear() {
      if (current === null && store.get(TOKEN_STORAGE_KEY) === null) return;
      current = null;
      store.remove(TOKEN_STORAGE_KEY);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
